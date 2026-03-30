import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import connectDB from '../src/db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from parent directory
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function expirePendingMessages() {
  try {
    await connectDB();
    console.log('🔄 Starting pending message expiration job...');
    console.log(`⏰ Current time: ${new Date().toISOString()}`);

    const ContactCampaignMessage = (await import('../src/models/contactMessage.model.js')).default;
    const Campaign = (await import('../src/models/campaign.model.js')).default;

    const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    console.log(`📅 Expiring messages older than: ${oneDayAgo.toISOString()} (1 day ago)`);

    // 1. Expire stale pending/sent messages
    const expireResult = await ContactCampaignMessage.updateMany(
      {
        status: { $in: ['pending', 'draft', 'queued'] },
        createdAt: { $lt: oneDayAgo }
      },
      {
        $set: {
          status: 'expired',
          failedAt: new Date(),
          errorCode: 'TIMEOUT',
          errorMessage: 'No webhook received within 1 day'
        }
      }
    );

    console.log(`✅ Expired ${expireResult.modifiedCount} messages older than 1 day`);

    // 2. Find campaigns that need settlement (24 hours)
    console.log(`📊 Checking campaigns older than: ${oneDayAgo.toISOString()} (1 day ago) for settlement`);
    
    // NOTE: Campaigns with messages that were just expired in Step 1 will now have pending=0
    // and will be settled in this run (no need to wait for next run)
    const campaignsToSettle = await Campaign.find({
      $or: [
        { status: 'completed', createdAt: { $lt: oneDayAgo } },
        { status: { $in: ['pending', 'processing', 'running'] }, createdAt: { $lt: oneDayAgo } }
      ]
    }).select('_id name status createdAt blockedAmount userId');

    console.log(`\n📊 Found ${campaignsToSettle.length} campaigns to check for settlement`);

    let settledCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const campaign of campaignsToSettle) {
      try {
        console.log(`\n[Campaign ${campaign._id}] ${campaign.name}`);
        console.log(`  Status: ${campaign.status}`);
        console.log(`  Created: ${campaign.createdAt.toISOString()}`);
        console.log(`  Blocked: ₹${campaign.blockedAmount || 0}`);

        // Skip if already settled
        if (campaign.status === 'settled') {
          console.log(`  ⏭️  Already settled, skipping`);
          skippedCount++;
          continue;
        }

        // Check message status with updated logic
        const messageStats = await ContactCampaignMessage.aggregate([
          { $match: { campaignId: campaign._id } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              pending: { $sum: { $cond: [{ $in: ['$status', ['draft', 'queued', 'pending']] }, 1, 0] } },
              sent: { $sum: { $cond: [{ $in: ['$status', ['sent', 'delivered', 'read', 'replied']] }, 1, 0] } },
              delivered: { $sum: { $cond: [{ $in: ['$status', ['delivered', 'read', 'replied']] }, 1, 0] } },
              expired: { $sum: { $cond: [{ $eq: ['$status', 'expired'] }, 1, 0] } },
              failed: { $sum: { $cond: [{ $in: ['$status', ['failed', 'bounced']] }, 1, 0] } }
            }
          }
        ]);

        const stats = messageStats[0] || { total: 0, pending: 0, sent: 0, delivered: 0, expired: 0, failed: 0 };
        console.log(`  Messages: ${stats.total} total, ${stats.pending} pending, ${stats.sent} sent, ${stats.delivered} delivered, ${stats.expired} expired, ${stats.failed} failed`);
        console.log(`  Chargeable: ${stats.sent} messages (failed messages excluded from billing)`);

        // Settle if no pending messages OR campaign is old enough
        if (stats.total === 0) {
          console.log(`  ⚠️  No messages found, skipping`);
          skippedCount++;
          continue;
        }

        if (stats.pending === 0) {
          console.log(`  ✅ No pending messages, settling campaign...`);
          console.log(`  💰 Will charge for ${stats.sent} sent messages, ${stats.failed} failed messages not charged`);
          await campaign.completeCampaign();
          console.log(`  ✅ Campaign settled successfully`);
          settledCount++;
        } else {
          console.log(`  ⏳ Still has ${stats.pending} pending messages, will retry next run`);
          skippedCount++;
        }
      } catch (err) {
        console.error(`  ❌ Error processing campaign ${campaign._id}:`, err.message);
        errorCount++;
      }
    }

    console.log(`\n📈 Summary:`);
    console.log(`  ✅ Settled: ${settledCount}`);
    console.log(`  ⏭️  Skipped: ${skippedCount}`);
    console.log(`  ❌ Errors: ${errorCount}`);
    console.log(`\n✅ Job completed successfully`);

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Fatal error:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

expirePendingMessages();