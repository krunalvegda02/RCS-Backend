import MessageLog from '../models/messageLog.model.js';
import ContactCampaignMessage from '../models/message.model.js';
import User from '../models/user.model.js';
import Campaign from '../models/campaign.model.js';

class MessageLogProcessor {
  constructor() {
    this.isProcessing = false;
    this.batchSize = 2000; // Optimized for high load (200K messages)
  }

  async start(intervalMs = 5000) {
    console.log(`[LogProcessor] Starting with ${intervalMs}ms interval`);
    
    setInterval(async () => {
      if (!this.isProcessing) {
        await this.processBatch();
      }
    }, intervalMs);
  }

  async processBatch() {
    this.isProcessing = true;
    
    try {
      const logs = await MessageLog.getUnprocessedLogs(this.batchSize);
      
      if (logs.length === 0) {
        this.isProcessing = false;
        return;
      }

      console.log(`[LogProcessor] Processing ${logs.length} webhook logs`);

      const bulkOps = [];
      const walletOps = new Map();
      const processedIds = [];

      for (const log of logs) {
        const { messageId, webhookData, campaignId, userId } = log;
        const eventType = webhookData?.eventType;
        const timestamp = log.timestamp;

        let newStatus = null;
        let updateFields = {};

        // Map webhook event to status
        switch (eventType) {
          case 'MESSAGE_SENT':
          case 'SEND_MESSAGE_SUCCESS':
            newStatus = 'sent';
            updateFields['campaigns.$.sentAt'] = new Date(timestamp);
            break;

          case 'MESSAGE_DELIVERED':
            newStatus = 'delivered';
            updateFields['campaigns.$.deliveredAt'] = new Date(timestamp);
            // Track wallet deduction
            if (!walletOps.has(userId)) walletOps.set(userId, { delivered: 0, refund: 0 });
            walletOps.get(userId).delivered += 1;
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
            // Track wallet refund
            if (!walletOps.has(userId)) walletOps.set(userId, { delivered: 0, refund: 0 });
            walletOps.get(userId).refund += 1;
            break;

          case 'USER_MESSAGE':
            newStatus = 'replied';
            updateFields['campaigns.$.lastInteractionAt'] = new Date(timestamp);
            if (webhookData.suggestionResponse) {
              updateFields['campaigns.$.suggestionResponse'] = webhookData.suggestionResponse;
              updateFields['campaigns.$.clickedAt'] = new Date(timestamp);
              updateFields['campaigns.$.clickedAction'] = webhookData.suggestionResponse.plainText;
            }
            if (webhookData.rawPayload?.entity?.text) {
              updateFields['campaigns.$.userText'] = webhookData.rawPayload.entity.text;
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
                },
                ...(webhookData.suggestionResponse && {
                  $inc: { 'campaigns.$.userClickCount': 1 }
                }),
                ...(webhookData.rawPayload?.entity?.text && {
                  $inc: { 'campaigns.$.userReplyCount': 1 }
                })
              }
            }
          });
        }

        processedIds.push(log._id);
      }

      // Execute bulk updates
      if (bulkOps.length > 0) {
        await ContactCampaignMessage.bulkWrite(bulkOps, { ordered: false });
        console.log(`[LogProcessor] Updated ${bulkOps.length} messages`);
      }

      // Process wallet operations in bulk
      for (const [userId, ops] of walletOps.entries()) {
        try {
          const user = await User.findById(userId);
          if (user) {
            user.wallet.blockedBalance = Math.max(0, (user.wallet.blockedBalance || 0) - ops.delivered - ops.refund);
            user.wallet.balance += ops.refund;
            user.wallet.lastUpdated = new Date();
            await user.save();
            console.log(`[LogProcessor] Wallet updated for user ${userId}: -${ops.delivered} delivered, +${ops.refund} refunded`);
          }
        } catch (error) {
          console.error(`[LogProcessor] Wallet error for ${userId}:`, error.message);
        }
      }

      // Mark logs as processed
      await MessageLog.markAsProcessed(processedIds);
      console.log(`[LogProcessor] Marked ${processedIds.length} logs as processed`);

    } catch (error) {
      console.error('[LogProcessor] Batch processing error:', error);
    } finally {
      this.isProcessing = false;
    }
  }
}

export default new MessageLogProcessor();
