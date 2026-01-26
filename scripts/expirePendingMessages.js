import mongoose from 'mongoose';
import connectDB from '../src/db/index.js';

async function expirePendingMessages() {
  try {
    await connectDB();
    console.log('🔄 Starting pending message expiration job...');

    const ContactCampaignMessage = (await import('../src/models/contactMessage.model.js')).default;
    const Campaign = (await import('../src/models/campaign.model.js')).default;

const sixHoursAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);


    // 1. Identify affected campaigns FIRST
    const affectedCampaignIds = await ContactCampaignMessage.distinct('campaignId', {
      status: { $in: ['pending', 'sent', 'draft'] },
      createdAt: { $lt: sixHoursAgo }
    });

    console.log(`Found ${affectedCampaignIds.length} campaigns with stale messages`);

    // 2. Expire the messages (flat model)
    const result = await ContactCampaignMessage.updateMany(
      {
        status: { $in: ['pending', 'sent', 'draft'] },
        createdAt: { $lt: sixHoursAgo }
      },
      {
        $set: {
          status: 'expired',
          failedAt: new Date(),
          errorCode: 'TIMEOUT',
          errorMessage: 'No webhook received within 5 minutes'
        }
      }
    );

    console.log(`✅ Expired ${result.modifiedCount} messages older than 5 minutes`);

    // 3. Get ALL completed campaigns that need settlement
    const allCampaignsToSettle = await Campaign.find({
      status: 'completed',
      createdAt: { $lt: sixHoursAgo }
    }).select('_id name status');

    console.log(`Found ${allCampaignsToSettle.length} campaigns to check for settlement`);

    // 4. Settle wallets and update campaign status
    if (allCampaignsToSettle.length > 0) {
      console.log('🔄 Settling campaigns and processing wallets...');

      for (const campaign of allCampaignsToSettle) {
        try {
          if (campaign.status === 'settled') {
            console.log(`Campaign ${campaign._id} already settled, skipping`);
            continue;
          }

          // Check if any pending messages remain
          const pendingCount = await ContactCampaignMessage.countDocuments({
            campaignId: campaign._id,
            status: { $in: ['draft', 'queued', 'pending', 'sent'] }
          });

          const totalCount = await ContactCampaignMessage.countDocuments({
            campaignId: campaign._id
          });

          console.log(`Campaign ${campaign._id}: ${pendingCount} pending out of ${totalCount} total`);

          if (pendingCount === 0 && totalCount > 0) {
            console.log(`✅ Settling campaign ${campaign._id}...`);
            await campaign.completeCampaign();
            console.log(`✅ Campaign ${campaign._id} settled successfully`);
          } else if (totalCount === 0) {
            console.log(`⚠️ Campaign ${campaign._id} has no messages, skipping`);
          } else {
            console.log(`Campaign ${campaign._id} still has ${pendingCount} pending messages`);
          }
        } catch (err) {
          console.error(`❌ Error processing campaign ${campaign._id}:`, err.message);
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