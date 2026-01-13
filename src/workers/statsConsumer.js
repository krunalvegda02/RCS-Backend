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
    
    let totalProcessed = 0;
    
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
        
        for (const log of logs) {
          const { messageId, webhookData, campaignId, userId } = log;
          const eventType = webhookData?.eventType;
          const entity = webhookData?.rawPayload?.entity;
          
          // Convert ObjectIds to strings for Map keys
          const userIdStr = userId?.toString ? userId.toString() : userId;
          const campaignIdObj = campaignId;
          
          const webhookTimestamp = entity?.sendTime || entity?.deliveryTime || 
                                   entity?.readTime || entity?.receiveTime || log.timestamp;
          const timestamp = new Date(webhookTimestamp);
          
          let newStatus = null;
          let updateFields = {};
          
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
              
            case 'USER_MESSAGE':
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
              break;
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
