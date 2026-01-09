import mongoose from 'mongoose';
import ContactCampaignMessage from '../src/models/message.model.js';
import MessageLog from '../src/models/messageLog.model.js';
import dotenv from 'dotenv';

dotenv.config();

async function fixTimestamps() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Get all message logs with webhook data
    const logs = await MessageLog.find({
      'webhookData.rawPayload.entity': { $exists: true }
    }).lean();

    console.log(`Found ${logs.length} message logs to process`);

    let fixed = 0;
    for (const log of logs) {
      const { messageId, webhookData, campaignId } = log;
      const entity = webhookData?.rawPayload?.entity;
      
      // Get the correct timestamp from webhook
      let webhookTimestamp;
      if (entity?.sendTime) {
        webhookTimestamp = entity.sendTime;
      } else if (entity?.deliveryTime) {
        webhookTimestamp = entity.deliveryTime;
      } else if (entity?.readTime) {
        webhookTimestamp = entity.readTime;
      } else if (entity?.receiveTime) {
        webhookTimestamp = entity.receiveTime;
      }

      if (!webhookTimestamp) continue;

      const correctTimestamp = new Date(webhookTimestamp);
      const eventType = webhookData?.eventType;

      // Update the message with correct timestamp
      const updateFields = {};
      
      if (eventType === 'MESSAGE_SENT' || eventType === 'SEND_MESSAGE_SUCCESS') {
        updateFields['campaigns.$.sentAt'] = correctTimestamp;
      } else if (eventType === 'MESSAGE_DELIVERED') {
        updateFields['campaigns.$.deliveredAt'] = correctTimestamp;
      } else if (eventType === 'MESSAGE_READ') {
        updateFields['campaigns.$.readAt'] = correctTimestamp;
      } else if (eventType === 'SEND_MESSAGE_FAILURE' || eventType === 'MESSAGE_EXPIRED' || eventType === 'MESSAGE_REVOKED') {
        updateFields['campaigns.$.failedAt'] = correctTimestamp;
      }

      if (Object.keys(updateFields).length > 0) {
        await ContactCampaignMessage.updateOne(
          {
            'campaigns.messageId': messageId,
            'campaigns.campaignId': campaignId
          },
          {
            $set: updateFields
          }
        );
        fixed++;
      }
    }

    console.log(`✅ Fixed ${fixed} message timestamps`);
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fixTimestamps();
