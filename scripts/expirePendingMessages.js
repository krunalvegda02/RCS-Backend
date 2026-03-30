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

    // Find campaigns older than 24 hours
    const pendingCount = await ContactCampaignMessage.countDocuments({
      status: { $in: ['pending', 'draft', 'queued'] }
    });
    
    const oldCampaigns = await Campaign.find({
      createdAt: { $lt: oneDayAgo }
    }).select('_id createdAt').lean();
    
    const oldCampaignIds = oldCampaigns.map(c => c._id);
    const oldPendingCount = await ContactCampaignMessage.countDocuments({
      status: { $in: ['pending', 'draft', 'queued'] },
      campaignId: { $in: oldCampaignIds }
    });
    
    console.log(`🔍 Debug: ${pendingCount} total pending messages`);
    console.log(`🔍 Debug: ${oldCampaigns.length} campaigns older than 24h`);
    console.log(`🔍 Debug: ${oldPendingCount} pending messages from old campaigns`);

    // 1. Expire stale pending/queued messages based on CAMPAIGN age (NOT message age)
    console.log(`⚡ Starting batch expiration of ${oldPendingCount} messages from ${oldCampaigns.length} old campaigns...`);
    
    if (oldPendingCount > 0) {
      let totalExpired = 0;
      
      // Process campaigns ONE AT A TIME to avoid Atlas timeouts
      for (let i = 0; i < oldCampaignIds.length; i++) {
        const campaignId = oldCampaignIds[i];
        
        try {
          // First check how many pending messages this campaign has
          const pendingForCampaign = await ContactCampaignMessage.countDocuments({
            status: { $in: ['pending', 'draft', 'queued'] },
            campaignId: campaignId
          });
          
          if (pendingForCampaign === 0) {
            // Skip campaigns with no pending messages
            continue;
          }
          
          const batchResult = await ContactCampaignMessage.updateMany(
            {
              status: { $in: ['pending', 'draft', 'queued'] },
              campaignId: campaignId
            },
            {
              $set: {
                status: 'expired',
                failedAt: new Date(),
                errorCode: 'TIMEOUT',
                errorMessage: 'No webhook received within 1 day - message never sent'
              }
            },
            { writeConcern: { w: 1, j: false, wtimeout: 10000 } } // 10s timeout per campaign
          );
          
          totalExpired += batchResult.modifiedCount;
          
          // Log individual campaign results for debugging
          if (batchResult.modifiedCount > 0) {
            console.log(`✅ Campaign ${campaignId}: Expired ${batchResult.modifiedCount} messages`);
          }
          
          // Log progress every 50 campaigns
          if ((i + 1) % 50 === 0 || i === oldCampaignIds.length - 1) {
            console.log(`⚡ Progress: ${i + 1}/${oldCampaignIds.length} campaigns processed, ${totalExpired} messages expired`);
          }
          
          // Small delay to prevent overwhelming Atlas
          if (i < oldCampaignIds.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
          }
        } catch (error) {
          console.error(`⚠️ Error expiring campaign ${campaignId}: ${error.message}`);
          // Continue with next campaign instead of failing completely
        }
      }
      
      console.log(`✅ Expired ${totalExpired} messages from campaigns older than 1 day`);
    } else {
      console.log(`✅ No pending messages to expire from old campaigns`);
    }

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
          console.log(`  ⚠️  No messages found - settling with 0 charge to release blocked amount`);
          await campaign.completeCampaign();
          console.log(`  ✅ Campaign settled with 0 charge, blocked amount released`);
          settledCount++;
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
          console.log(`  📊 Note: ${stats.sent} sent messages are chargeable even without delivery confirmation`);
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