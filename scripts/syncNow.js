import mongoose from 'mongoose';
import dotenv from 'dotenv';
import MessageLog from '../src/models/messageLog.model.js';
import ContactCampaignMessage from '../src/models/message.model.js';

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

async function syncNow() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to Atlas\n');
    console.log('🔄 Starting sync...\n');

    let totalProcessed = 0;
    let hasMore = true;

    while (hasMore) {
      // Get batch of unprocessed logs
      const logs = await MessageLog.find({ processed: false })
        .sort({ timestamp: 1 })
        .limit(2000)
        .lean();

      if (logs.length === 0) {
        hasMore = false;
        break;
      }

      console.log(`Processing batch of ${logs.length} logs...`);

      const bulkOps = [];
      const processedIds = [];

      for (const log of logs) {
        const { messageId, webhookData, campaignId } = log;
        const eventType = webhookData?.eventType;
        const timestamp = log.timestamp;

        let newStatus = null;
        let updateFields = {};

        switch (eventType) {
          case 'MESSAGE_SENT':
          case 'SEND_MESSAGE_SUCCESS':
            newStatus = 'sent';
            updateFields['campaigns.$.sentAt'] = new Date(timestamp);
            break;

          case 'MESSAGE_DELIVERED':
            newStatus = 'delivered';
            updateFields['campaigns.$.deliveredAt'] = new Date(timestamp);
            break;

          case 'MESSAGE_READ':
            newStatus = 'read';
            updateFields['campaigns.$.readAt'] = new Date(timestamp);
            break;

          case 'SEND_MESSAGE_FAILURE':
          case 'MESSAGE_EXPIRED':
          case 'MESSAGE_REVOKED':
            newStatus = 'failed';
            updateFields['campaigns.$.failedAt'] = new Date(timestamp);
            updateFields['campaigns.$.errorCode'] = webhookData.rawPayload?.entity?.error?.code || 'UNKNOWN';
            updateFields['campaigns.$.errorMessage'] = webhookData.rawPayload?.entity?.error?.message || 'Failed';
            break;

          case 'USER_MESSAGE':
            newStatus = 'replied';
            updateFields['campaigns.$.lastInteractionAt'] = new Date(timestamp);
            if (webhookData.suggestionResponse) {
              updateFields['campaigns.$.suggestionResponse'] = webhookData.suggestionResponse;
            }
            break;
        }

        if (newStatus) {
          bulkOps.push({
            updateOne: {
              filter: {
                'campaigns.messageId': messageId,
                'campaigns.campaignId': campaignId
              },
              update: {
                $set: {
                  'campaigns.$.status': newStatus,
                  'campaigns.$.lastWebhookAt': new Date(timestamp),
                  ...updateFields
                }
              }
            }
          });
        }

        processedIds.push(log._id);
      }

      // Execute bulk updates
      if (bulkOps.length > 0) {
        try {
          await ContactCampaignMessage.bulkWrite(bulkOps, { ordered: false });
        } catch (bulkError) {
          console.log('⚠️  Bulk write error (some updates may have succeeded):', bulkError.message);
        }
      }

      // Mark as processed
      await MessageLog.updateMany(
        { _id: { $in: processedIds } },
        { $set: { processed: true, processedAt: new Date() } }
      );

      totalProcessed += logs.length;
      console.log(`✅ Processed ${totalProcessed} logs so far...`);
    }

    console.log(`\n🎉 SYNC COMPLETE!`);
    console.log(`Total processed: ${totalProcessed} logs`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
  }
}

syncNow();
