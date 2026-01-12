import mongoose from 'mongoose';
import { connectConsumer, disconnectKafka } from '../services/kafka.service.js';
import connectDB from '../db/index.js';

process.env.WORKER_MODE = 'true';

async function startKafkaConsumer() {
  try {
    await connectDB();
    console.log('✅ Kafka Consumer connected to MongoDB');
    
    const consumer = await connectConsumer();
    const MessageLog = (await import('../models/messageLog.model.js')).default;
    const ContactCampaignMessage = (await import('../models/contact_campaign_message.model.js')).default;
    
    let totalProcessed = 0;
    let totalSkipped = 0;
    
    // 🔥 In-memory cache for messageId → userId/campaignId
    const messageCache = new Map();
    let lastCacheRefresh = Date.now();
    
    await consumer.run({
      partitionsConsumedConcurrently: 20,
      eachBatchAutoResolve: false,
      eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning, isStale }) => {
        const startTime = Date.now();
        const messages = batch.messages;
        
        const parsedData = [];
        for (const message of messages) {
          if (!isRunning() || isStale()) break;
          
          try {
            const webhookData = JSON.parse(message.value.toString());
            const data = webhookData.data;
            const messageId = data?.entity?.messageId || data?.messageId;
            
            parsedData.push({
              offset: message.offset,
              messageId,
              entityType: data?.entityType,
              eventType: data?.entity?.eventType || data?.eventType,
              phoneNumber: data?.userPhoneNumber || data?.entity?.userPhoneNumber,
              suggestionResponse: data?.entity?.suggestionResponse,
              rawPayload: data,
              timestamp: webhookData.timestamp
            });
          } catch (error) {
            await resolveOffset(message.offset);
          }
        }
        
        const messageIds = parsedData.map(p => p.messageId).filter(Boolean);
        if (messageIds.length === 0) {
          await heartbeat();
          return;
        }
        
        // Check cache first
        const uncachedIds = [];
        const messageMap = {};
        
        for (const id of messageIds) {
          if (messageCache.has(id)) {
            messageMap[id] = messageCache.get(id);
          } else {
            uncachedIds.push(id);
          }
        }
        
        // Query DB only for uncached IDs
        if (uncachedIds.length > 0) {
          const messageDocs = await ContactCampaignMessage.find({
            $or: [
              { 'campaigns.messageId': { $in: uncachedIds } },
              { 'campaigns.jioMessageId': { $in: uncachedIds } },
              { 'campaigns.rcsMessageId': { $in: uncachedIds } }
            ]
          }, { userId: 1, campaigns: 1 }).lean();
          
          messageDocs.forEach(doc => {
            doc.campaigns?.forEach(camp => {
              const info = { userId: doc.userId, campaignId: camp.campaignId };
              if (camp.messageId) {
                messageMap[camp.messageId] = info;
                messageCache.set(camp.messageId, info);
              }
              if (camp.jioMessageId) {
                messageMap[camp.jioMessageId] = info;
                messageCache.set(camp.jioMessageId, info);
              }
              if (camp.rcsMessageId) {
                messageMap[camp.rcsMessageId] = info;
                messageCache.set(camp.rcsMessageId, info);
              }
            });
          });
        }
        
        const logsToInsert = [];
        let skippedCount = 0;
        
        for (const parsed of parsedData) {
          const msgInfo = messageMap[parsed.messageId];
          if (msgInfo?.userId) {
            logsToInsert.push({
              messageId: parsed.messageId,
              campaignId: msgInfo.campaignId,
              userId: msgInfo.userId,
              eventType: parsed.entityType === 'USER_MESSAGE' ? 'user_interaction' : 'status_update',
              status: 'success',
              webhookData: {
                eventType: parsed.eventType,
                phoneNumber: parsed.phoneNumber,
                interactionType: parsed.entityType === 'USER_MESSAGE' ? 'text_reply' : undefined,
                suggestionResponse: parsed.suggestionResponse,
                rawPayload: parsed.rawPayload
              },
              processed: false,
              timestamp: new Date(parsed.timestamp),
              metadata: { source: 'webhook' }
            });
          } else {
            skippedCount++;
          }
        }
        
        totalSkipped += skippedCount;
        totalProcessed += logsToInsert.length;
        
        if (logsToInsert.length > 0) {
          try {
            await MessageLog.insertMany(logsToInsert, { ordered: false });
            const duration = Date.now() - startTime;
            const rate = Math.round(logsToInsert.length / (duration / 1000));
            console.log(`[Webhook] ✅ ${logsToInsert.length} logs in ${duration}ms (${rate}/sec) | Total: ${totalProcessed}`);
          } catch (bulkError) {
            if (!bulkError.message.includes('E11000')) {
              console.error('[Webhook] Error:', bulkError.message);
            }
          }
        }
        
        if (messages.length > 0) {
          const highestOffset = messages[messages.length - 1].offset;
          await resolveOffset(highestOffset);
        }
        
        await heartbeat();
        
        if (Date.now() - lastCacheRefresh > 60000) {
          if (messageCache.size > 100000) {
            messageCache.clear();
            console.log('[Webhook] Cache cleared');
          }
          lastCacheRefresh = Date.now();
        }
      }
    });

    const shutdown = async () => {
      console.log('🛑 Shutting down...');
      messageCache.clear();
      await disconnectKafka();
      await mongoose.connection.close();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

  } catch (error) {
    console.error('❌ Startup failed:', error);
    process.exit(1);
  }
}

startKafkaConsumer();
