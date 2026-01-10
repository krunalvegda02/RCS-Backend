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
      groupId: 'stats-processor-group',
      sessionTimeout: 30000,
      heartbeatInterval: 3000
    });
    
    await consumer.connect();
    await consumer.subscribe({ topic: 'message-log-processing', fromBeginning: false });
    console.log('✅ Stats Consumer subscribed to message-log-processing');
    
    const MessageLog = (await import('../models/messageLog.model.js')).default;
    const ContactCampaignMessage = (await import('../models/message.model.js')).default;
    const User = (await import('../models/user.model.js')).default;
    
    let totalProcessed = 0;
    
    await consumer.run({
      partitionsConsumedConcurrently: 10,
      eachBatchAutoResolve: false,
      eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning, isStale }) => {
        const startTime = Date.now();
        const messages = batch.messages.slice(0, 2000);
        
        const logIds = messages.map(m => JSON.parse(m.value.toString()).logId);
        
        // Fetch unprocessed logs
        const logs = await MessageLog.find({
          _id: { $in: logIds },
          processed: false
        }).lean();
        
        if (logs.length === 0) {
          for (const msg of messages) await resolveOffset(msg.offset);
          await heartbeat();
          return;
        }
        
        // Mark as processed atomically
        const markResult = await MessageLog.updateMany(
          { _id: { $in: logs.map(l => l._id) }, processed: false },
          { $set: { processed: true, processedAt: new Date() } }
        );
        
        if (markResult.modifiedCount === 0) {
          for (const msg of messages) await resolveOffset(msg.offset);
          await heartbeat();
          return;
        }
        
        const bulkOps = [];
        const walletOps = new Map();
        
        for (const log of logs) {
          const { messageId, webhookData, campaignId, userId } = log;
          const eventType = webhookData?.eventType;
          const entity = webhookData?.rawPayload?.entity;
          
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
              if (!walletOps.has(userId)) walletOps.set(userId, { delivered: 0, refund: 0 });
              walletOps.get(userId).delivered += 1;
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
              if (!walletOps.has(userId)) walletOps.set(userId, { delivered: 0, refund: 0 });
              walletOps.get(userId).refund += 1;
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
                  'campaigns.campaignId': campaignId
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
        if (bulkOps.length > 0) {
          try {
            const result = await ContactCampaignMessage.bulkWrite(bulkOps, { ordered: false });
            totalProcessed += result.modifiedCount;
            console.log(`[Stats] ✅ ${result.modifiedCount} messages updated | Total: ${totalProcessed}`);
          } catch (error) {
            console.error('[Stats] Bulk write error:', error.message);
          }
        }
        
        // Bulk update wallets
        if (walletOps.size > 0) {
          const walletBulk = [];
          for (const [userId, ops] of walletOps.entries()) {
            walletBulk.push({
              updateOne: {
                filter: { _id: userId },
                update: {
                  $inc: {
                    'wallet.blockedBalance': -(ops.delivered + ops.refund),
                    'wallet.balance': ops.refund
                  },
                  $set: { 'wallet.lastUpdated': new Date() }
                }
              }
            });
          }
          try {
            await User.bulkWrite(walletBulk, { ordered: false });
            console.log(`[Stats] ✅ ${walletOps.size} wallets updated`);
          } catch (error) {
            console.error('[Stats] Wallet error:', error.message);
          }
        }
        
        const duration = Date.now() - startTime;
        console.log(`[Stats] Batch: ${logs.length} logs in ${duration}ms`);
        
        for (const msg of messages) await resolveOffset(msg.offset);
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
