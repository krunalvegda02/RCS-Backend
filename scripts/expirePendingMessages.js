import mongoose from 'mongoose';
import connectDB from '../src/db/index.js';

async function expirePendingMessages() {
  try {
    await connectDB();
    console.log('🔄 Starting pending message expiration job...');

    const ContactCampaignMessage = (await import('../src/models/contact_campaign_message.model.js')).default;

    // Find messages that are pending OR sent for more than 48 hours without response
    // const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);




    // 1. Identify affected campaigns FIRST (before updating)
    const affectedCampaignIds = await ContactCampaignMessage.distinct('campaigns.campaignId', {
      'campaigns.status': { $in: ['pending', 'sent', 'draft'] },
      'createdAt': { $lt: fiveMinutesAgo }
    });

    console.log(`found ${affectedCampaignIds.length} campaigns with stale messages`);




    // 2. Expire the messages
    const result = await ContactCampaignMessage.updateMany(
      {
        'campaigns.status': { $in: ['pending', 'sent', 'draft'] },
        'createdAt': { $lt: fiveMinutesAgo }
      },
      {
        $set: {
          'campaigns.$.status': 'expired',
          'campaigns.$.failedAt': new Date(),
          'campaigns.$.errorCode': 'TIMEOUT',
          'campaigns.$.errorMessage': 'No webhook received within 48 hours'
        }
      }
    );



    console.log(`✅ Expired ${result.modifiedCount} pending/sent messages older than 48 hours`);



    // 3. Trigger wallet refund / campaign completion for affected campaigns
    if (result.modifiedCount > 0 && affectedCampaignIds.length > 0) {
      console.log('🔄 Checking for campaign completion and wallet refunds...');
      const Campaign = (await import('../src/models/campaign.model.js')).default;

      for (const campaignId of affectedCampaignIds) {
        try {
          const campaign = await Campaign.findById(campaignId);
          if (!campaign || campaign.status === 'completed') continue;

          // Check if any pending messages remain for this campaign
          // (We just expired the old ones, but are there new ones?)
          const stats = await ContactCampaignMessage.aggregate([
            { $match: { userId: campaign.userId } },
            { $unwind: '$campaigns' },
            { $match: { 'campaigns.campaignId': campaign._id } },
            {
              $group: {
                _id: null,
                pending: { $sum: { $cond: [{ $in: ['$campaigns.status', ['draft', 'queued', 'pending']] }, 1, 0] } }
              }
            }
          ]);

          const pendingCount = stats[0]?.pending || 0;

          if (pendingCount === 0) {
            console.log(`[ExpirationJob] Completing campaign ${campaign._id} and refunding wallet...`);
            await campaign.completeCampaign();
            console.log(`[ExpirationJob] ✅ Campaign ${campaign._id} completed`);
          } else {
            console.log(`[ExpirationJob] Campaign ${campaign._id} still has ${pendingCount} new pending messages. Skipping completion.`);
          }
        } catch (err) {
          console.error(`[ExpirationJob] ❌ Error processing campaign ${campaignId}:`, err.message);
        }
      }
    }

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error expiring pending messages:', error);
    process.exit(1);
  }
}

expirePendingMessages();