import mongoose from 'mongoose';
import connectDB from '../src/db/index.js';

async function expirePendingMessages() {
  try {
    await connectDB();
    console.log('🔄 Starting pending message expiration job...');
    console.log(`⏰ Current time: ${new Date().toISOString()}`);

    const ContactCampaignMessage = (await import('../src/models/contactMessage.model.js')).default;
    const Campaign = (await import('../src/models/campaign.model.js')).default;

    const oneDaysAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    console.log(`📅 Expiring messages older than: ${oneDaysAgo.toISOString()} (2 days ago)`);

    // 1. Expire stale pending/sent messages
    const expireResult = await ContactCampaignMessage.updateMany(
      {
        status: { $in: ['pending', 'sent', 'draft', 'queued'] },
        createdAt: { $lt: oneDaysAgo }
      },
      {
        $set: {
          status: 'expired',
          failedAt: new Date(),
          errorCode: 'TIMEOUT',
          errorMessage: 'No webhook received within 2 days'
        }
      }
    );

    console.log(`✅ Expired ${expireResult.modifiedCount} messages older than 2 days`);

    // 2. Find campaigns that need settlement
    // NOTE: Campaigns with messages that were just expired in Step 1 will now have pending=0
    // and will be settled in this run (no need to wait for next run)
    const campaignsToSettle = await Campaign.find({
      $or: [
        { status: 'completed', createdAt: { $lt: oneDaysAgo } },
        { status: { $in: ['pending', 'processing', 'running'] }, createdAt: { $lt: oneDaysAgo } }
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

        // Check message status
        const messageStats = await ContactCampaignMessage.aggregate([
          { $match: { campaignId: campaign._id } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              pending: { $sum: { $cond: [{ $in: ['$status', ['draft', 'queued', 'pending', 'sent']] }, 1, 0] } },
              delivered: { $sum: { $cond: [{ $in: ['$status', ['delivered', 'read', 'replied']] }, 1, 0] } },
              expired: { $sum: { $cond: [{ $eq: ['$status', 'expired'] }, 1, 0] } },
              failed: { $sum: { $cond: [{ $in: ['$status', ['failed', 'bounced']] }, 1, 0] } }
            }
          }
        ]);

        const stats = messageStats[0] || { total: 0, pending: 0, delivered: 0, expired: 0, failed: 0 };
        console.log(`  Messages: ${stats.total} total, ${stats.pending} pending, ${stats.delivered} delivered, ${stats.expired} expired, ${stats.failed} failed`);

        // Settle if no pending messages OR campaign is old enough
        if (stats.total === 0) {
          console.log(`  ⚠️  No messages found, skipping`);
          skippedCount++;
          continue;
        }

        if (stats.pending === 0) {
          console.log(`  ✅ No pending messages, settling campaign...`);
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