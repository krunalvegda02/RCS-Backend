import MessageLog from '../models/messageLog.model.js';
import ContactCampaignMessage from '../models/message.model.js';
import User from '../models/user.model.js';
import Campaign from '../models/campaign.model.js';

class MessageLogProcessor {
  constructor() {
    this.isProcessing = false;
    this.batchSize = 5000; // Increased for 200K+ logs
  }

  async start(intervalMs = 5000) {
    console.log(`[LogProcessor] Starting with ${intervalMs}ms interval`);
    
    // Process immediately on start
    await this.processAllPending();
    
    setInterval(async () => {
      if (!this.isProcessing) {
        await this.processAllPending();
      }
    }, intervalMs);
  }

  async processAllPending() {
    this.isProcessing = true;
    
    try {
      let totalProcessed = 0;
      let hasMore = true;

      while (hasMore) {
        const logs = await MessageLog.getUnprocessedLogs(this.batchSize);
        
        if (logs.length === 0) {
          hasMore = false;
          if (totalProcessed > 0) {
            console.log(`[LogProcessor] ✅ Completed processing ${totalProcessed} logs`);
          }
          break;
        }

        console.log(`[LogProcessor] Processing batch of ${logs.length} logs...`);
        await this.processBatch(logs);
        totalProcessed += logs.length;
      }
    } catch (error) {
      console.error('[LogProcessor] Error in processAllPending:', error.message);
    } finally {
      this.isProcessing = false;
    }
  }

  async processBatch(logs) {
    const bulkOps = [];
    const walletOps = new Map();
    const logIds = logs.map(l => l._id);

    // Mark logs as being processed immediately (atomic operation)
    const markResult = await MessageLog.updateMany(
      { _id: { $in: logIds }, processed: false },
      { $set: { processed: true, processedAt: new Date() } }
    );

    // If no logs were actually marked (another worker got them), skip processing
    if (markResult.modifiedCount === 0) {
      console.log(`[LogProcessor] ⚠️  Batch already processed by another worker, skipping...`);
      return;
    }

    console.log(`[LogProcessor] Locked ${markResult.modifiedCount} logs for processing`);

    const processedIds = [];

    for (const log of logs) {
        const { messageId, webhookData, campaignId, userId } = log;
        const eventType = webhookData?.eventType;
        const entity = webhookData?.rawPayload?.entity;
        
        // Get timestamp based on event type
        let webhookTimestamp;
        if (entity?.sendTime) {
          webhookTimestamp = entity.sendTime; // For SEND_MESSAGE_FAILURE, MESSAGE_SENT
        } else if (entity?.deliveryTime) {
          webhookTimestamp = entity.deliveryTime; // For MESSAGE_DELIVERED
        } else if (entity?.readTime) {
          webhookTimestamp = entity.readTime; // For MESSAGE_READ
        } else if (entity?.receiveTime) {
          webhookTimestamp = entity.receiveTime; // For USER_MESSAGE
        } else {
          webhookTimestamp = log.timestamp; // Fallback to log creation time
        }
        
        const timestamp = new Date(webhookTimestamp);

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
        processedIds.push(log._id);
      }

      // Execute bulk updates
      if (bulkOps.length > 0) {
        try {
          const result = await ContactCampaignMessage.bulkWrite(bulkOps, { ordered: false });
          console.log(`[LogProcessor] ✅ Messages: ${result.modifiedCount} updated, ${result.matchedCount} matched`);
        } catch (bulkError) {
          console.error(`[LogProcessor] Bulk write error:`, bulkError.message);
        }
      } else {
        console.log(`[LogProcessor] ⚠️  No message updates (0 bulk operations)`);
      }

      // Process wallet operations in bulk
      if (walletOps.size > 0) {
        console.log(`[LogProcessor] Processing wallet updates for ${walletOps.size} users...`);
        for (const [userId, ops] of walletOps.entries()) {
          try {
            await User.updateOne(
              { _id: userId },
              {
                $inc: {
                  'wallet.blockedBalance': -(ops.delivered + ops.refund),
                  'wallet.balance': ops.refund
                },
                $set: { 'wallet.lastUpdated': new Date() }
              }
            );
            console.log(`[LogProcessor] ✅ Wallet updated: User ${userId} | Delivered: ${ops.delivered}, Refund: ${ops.refund}`);
          } catch (error) {
            console.error(`[LogProcessor] Wallet error for ${userId}:`, error.message);
          }
        }
      }

      // Mark logs as processed (already done at start of batch)
      console.log(`[LogProcessor] ✅ Marked ${processedIds.length} logs as processed`);
  }
}

export default new MessageLogProcessor();
