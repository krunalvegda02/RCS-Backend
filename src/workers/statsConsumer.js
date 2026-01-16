import mongoose from 'mongoose';
import { Kafka } from 'kafkajs';
import connectDB from '../db/index.js';

process.env.WORKER_MODE = 'true';

async function startStatsConsumer() {
  try {
    await connectDB();
    console.log('✅ Stats Consumer connected to MongoDB');
    
    const kafka = new Kafka({
      clientId: 'stats-consumer',
      brokers: [process.env.KAFKA_BROKER || 'localhost:9092']
    });
    
    const consumer = kafka.consumer({ 
      groupId: `stats-processor-${process.env.NODE_ENV || 'dev'}`,
      sessionTimeout: 30000,
      heartbeatInterval: 3000
    });
    
    await consumer.connect();
    await consumer.subscribe({ topic: 'message-log-processing', fromBeginning: true });
    console.log('✅ Stats Consumer subscribed to message-log-processing');
    
    const MessageLog = (await import('../models/messageLog.model.js')).default;
    const User = (await import('../models/user.model.js')).default;
    const ContactCampaignMessage = (await import('../models/contact_campaign_message.model.js')).default;
    const Campaign = (await import('../models/campaign.model.js')).default;
    
    let totalProcessed = 0;
    const campaignsToCheck = new Set(); // Track campaigns that need completion check
    
    await consumer.run({
      partitionsConsumedConcurrently: 10,
      eachBatchAutoResolve: false,
      eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning, isStale }) => {
        const startTime = Date.now();
        // 🔥 FIX #1 & #2: Process ALL messages in batch, ACK only on success
        const messages = batch.messages;
        const logIds = messages.map(m => JSON.parse(m.value.toString()).logId);
        
        console.log(`[StatsConsumer] Processing batch of ${logIds.length} log IDs`);
        
        const logs = await MessageLog.find({
          _id: { $in: logIds },
          processed: false
        }).lean();
        
        console.log(`[StatsConsumer] Found ${logs.length} unprocessed logs in DB`);
        
        if (logs.length === 0) {
          console.log('[StatsConsumer] No unprocessed logs, ACKing batch');
          if (messages.length > 0) {
            await resolveOffset(messages[messages.length - 1].offset);
          }
          await heartbeat();
          return;
        }
        
        const bulkOps = [];
        const walletOps = new Map();
        campaignsToCheck.clear(); // Clear before processing batch
        
        for (const log of logs) {
          const { messageId, webhookData, campaignId, userId, eventType: logEventType } = log;
          const eventType = webhookData?.eventType;
          const entity = webhookData?.rawPayload?.entity;
          const entityType = webhookData?.rawPayload?.entityType;
          
          // Track campaign for completion check
          if (campaignId) {
            campaignsToCheck.add(campaignId.toString());
          }
          
          // Convert ObjectIds to strings for Map keys
          const userIdStr = userId?.toString ? userId.toString() : userId;
          const campaignIdObj = campaignId;
          
          const webhookTimestamp = entity?.sendTime || entity?.deliveryTime || 
                                   entity?.readTime || entity?.receiveTime || log.timestamp;
          const timestamp = new Date(webhookTimestamp);
          
          let newStatus = null;
          let updateFields = {};
          
          // Check if this is a user interaction (click or reply)
          const isUserInteraction = logEventType === 'user_interaction' || entityType === 'USER_MESSAGE';
          
          if (isUserInteraction) {
            newStatus = 'replied';
            updateFields['campaigns.$.lastInteractionAt'] = timestamp;
            if (webhookData.suggestionResponse) {
              updateFields['campaigns.$.suggestionResponse'] = webhookData.suggestionResponse;
              updateFields['campaigns.$.clickedAt'] = timestamp;
              updateFields['campaigns.$.clickedAction'] = webhookData.suggestionResponse.plainText;
            }
            if (webhookData.rawPayload?.entity?.text) {
              updateFields['campaigns.$.userText'] = webhookData.rawPayload.entity.text;
            }
          } else {
            switch (eventType) {
            case 'MESSAGE_SENT':
            case 'SEND_MESSAGE_SUCCESS':
              newStatus = 'sent';
              updateFields['campaigns.$.sentAt'] = timestamp;
              break;
              
            case 'MESSAGE_DELIVERED':
              newStatus = 'delivered';
              updateFields['campaigns.$.deliveredAt'] = timestamp;
              if (!walletOps.has(userIdStr)) walletOps.set(userIdStr, { delivered: 0, refund: 0 });
              walletOps.get(userIdStr).delivered += 1;
              break;
              
            case 'MESSAGE_READ':
              newStatus = 'read';
              updateFields['campaigns.$.readAt'] = timestamp;
              break;
              
            case 'SEND_MESSAGE_FAILURE':
            case 'MESSAGE_EXPIRED':
            case 'MESSAGE_REVOKED':
              newStatus = 'failed';
              updateFields['campaigns.$.failedAt'] = timestamp;
              updateFields['campaigns.$.errorCode'] = webhookData.rawPayload?.entity?.error?.code || 'UNKNOWN';
              updateFields['campaigns.$.errorMessage'] = webhookData.rawPayload?.entity?.error?.message || 'Failed';
              if (!walletOps.has(userIdStr)) walletOps.set(userIdStr, { delivered: 0, refund: 0 });
              walletOps.get(userIdStr).refund += 1;
              break;
            }
          }
          
          if (newStatus) {
            bulkOps.push({
              updateOne: {
                filter: {
                  'campaigns.messageId': messageId,
                  'campaigns.campaignId': campaignIdObj
                },
                update: {
                  $set: {
                    'campaigns.$.status': newStatus,
                    'campaigns.$.lastWebhookAt': timestamp,
                    ...updateFields
                  },
                  $inc: {
                    ...(webhookData.suggestionResponse && { 'campaigns.$.userClickCount': 1 }),
                    ...(webhookData.rawPayload?.entity?.text && { 'campaigns.$.userReplyCount': 1 })
                  }
                }
              }
            });
          }
        }
        
        // Bulk update messages
        let messageUpdateSuccess = false;
        if (bulkOps.length > 0) {
          try {
            const result = await ContactCampaignMessage.bulkWrite(bulkOps, { ordered: false });
            totalProcessed += result.modifiedCount;
            messageUpdateSuccess = true;
            console.log(`[StatsConsumer] ✅ Updated ${result.modifiedCount} messages | Total: ${totalProcessed}`);
          } catch (error) {
            console.error('[StatsConsumer] Bulk write error:', error.message);
          }
        } else {
          console.log('[StatsConsumer] No message updates needed');
          messageUpdateSuccess = true; // No updates needed is success
        }
        
        // Bulk update wallets (only if message updates succeeded)
        // if (messageUpdateSuccess && walletOps.size > 0) {
        //   const walletBulk = [];
        //   for (const [userIdStr, ops] of walletOps.entries()) {
        //     walletBulk.push({
        //       updateOne: {
        //         filter: { _id: userIdStr },
        //         update: {
        //           $inc: {
        //             'wallet.blockedBalance': -(ops.delivered + ops.refund),
        //             'wallet.balance': ops.refund
        //           },
        //           $set: { 'wallet.lastUpdated': new Date() }
        //         }
        //       }
        //     });
        //   }
        //   try {
        //     await User.bulkWrite(walletBulk, { ordered: false });
        //     console.log(`[StatsConsumer] ✅ Updated ${walletOps.size} wallets`);
        //   } catch (error) {
        //     console.error('[StatsConsumer] Wallet error:', error.message);
        //   }
        // }
        
        // 🔥 FIX #1: Mark as processed ONLY AFTER successful updates
        let allSuccess = false;
        
        if (messageUpdateSuccess) {
          try {
            const markResult = await MessageLog.updateMany(
              { _id: { $in: logs.map(l => l._id) }, processed: false },
              { $set: { processed: true, processedAt: new Date() } }
            );
            console.log(`[StatsConsumer] Marked ${markResult.modifiedCount} logs as processed`);
            allSuccess = true;
          } catch (error) {
            console.error('[StatsConsumer] ❌ Mark processed failed:', error.message);
          }
        }
        
        const duration = Date.now() - startTime;
        console.log(`[StatsConsumer] Batch complete: ${logs.length} logs in ${duration}ms`);
        
        // Check campaign completion for all affected campaigns
        if (allSuccess && campaignsToCheck.size > 0) {
          console.log(`[StatsConsumer] Checking completion for ${campaignsToCheck.size} campaigns`);
          for (const campaignId of campaignsToCheck) {
            try {
              const campaign = await Campaign.findById(campaignId);
              if (campaign && campaign.status === 'pending') {
                // Check if all messages are processed
                const stats = await ContactCampaignMessage.aggregate([
                  { $match: { userId: campaign.userId } },
                  { $unwind: '$campaigns' },
                  { $match: { 'campaigns.campaignId': campaign._id } },
                  {
                    $group: {
                      _id: null,
                      total: { $sum: 1 },
                      pending: { $sum: { $cond: [{ $in: ['$campaigns.status', ['draft', 'queued', 'pending']] }, 1, 0] } },
                      processed: { $sum: { $cond: [{ $in: ['$campaigns.status', ['sent', 'delivered', 'read', 'replied', 'failed']] }, 1, 0] } }
                    }
                  }
                ]);
                
                const { total = 0, pending = 0, processed = 0 } = stats[0] || {};
                
                // If all messages are processed (no pending), complete the campaign
                if (total > 0 && pending === 0 && processed >= total) {
                  console.log(`[StatsConsumer] 🏁 Campaign ${campaignId} ready for completion: ${processed}/${total} processed`);
                  await campaign.completeCampaign();
                  console.log(`[StatsConsumer] ✅ Campaign ${campaignId} completed with wallet adjustment`);
                }
              }
            } catch (error) {
              console.error(`[StatsConsumer] Error checking campaign ${campaignId}:`, error.message);
            }
          }
        }
        
        // 🔥 FIX #1: ACK only if everything succeeded
        if (allSuccess && messages.length > 0) {
          await resolveOffset(messages[messages.length - 1].offset);
        }
        await heartbeat();
      }
    });
    
    const shutdown = async () => {
      console.log('🛑 Shutting down stats consumer...');
      await consumer.disconnect();
      await mongoose.connection.close();
      process.exit(0);
    };
    
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    
  } catch (error) {
    console.error('❌ Stats consumer startup failed:', error);
    process.exit(1);
  }
}

startStatsConsumer();
