import mongoose from 'mongoose';
import { connectConsumer, disconnectKafka } from '../services/kafka.service.js';
import connectDB from '../db/index.js';
import { LRUCache } from 'lru-cache';

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
    
    // 🔥 LRU cache with max 200K entries and 30min TTL for high volume
    const messageCache = new LRUCache({
      max: 200000, // Increased for 4K+/sec throughput
      ttl: 1000 * 60 * 30, // 30 minutes
      updateAgeOnGet: true
    });
    
    await consumer.run({
      partitionsConsumedConcurrently: 20,
      eachBatchAutoResolve: false,
      eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning, isStale }) => {
        const startTime = Date.now();
        // Limit batch size to prevent memory issues at high volume
        const messages = batch.messages.slice(0, 5000);
        
        const parsedData = [];
        for (const message of messages) {
          if (!isRunning() || isStale()) break;
          
          try {
            const webhookData = JSON.parse(message.value.toString());
            const data = webhookData.data;
            
            // Validate webhook data (non-blocking, happens in consumer)
            if (!data) {
              console.error('[Webhook] Invalid webhook: missing data');
              await resolveOffset(message.offset);
              continue;
            }
            
            const messageId = data?.entity?.messageId || data?.messageId;
            if (!messageId) {
              console.error('[Webhook] Invalid webhook: missing messageId');
              await resolveOffset(message.offset);
              continue;
            }
            
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
            console.error('[Webhook] Parse error:', error.message);
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
          try {
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
          } catch (error) {
            console.error('[Webhook] DB query error:', error.message);
            // On error, skip this batch and continue
            if (messages.length > 0) {
              const highestOffset = messages[messages.length - 1].offset;
              await resolveOffset(highestOffset);
            }
            await heartbeat();
            return;
          }
        }
        
        const logsToInsert = [];
        let skippedCount = 0;
        
        for (const parsed of parsedData) {
          const msgInfo = messageMap[parsed.messageId];
          if (msgInfo?.userId) {
            // Convert ObjectIds to strings for schema compatibility
            const userIdStr = msgInfo.userId?.toString ? msgInfo.userId.toString() : msgInfo.userId;
            const campaignIdStr = msgInfo.campaignId?.toString ? msgInfo.campaignId.toString() : msgInfo.campaignId;
            
            logsToInsert.push({
              messageId: parsed.messageId,
              campaignId: campaignIdStr,
              userId: userIdStr,
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
            
            // ✅ Resolve offset AFTER successful insert
            if (messages.length > 0) {
              const highestOffset = messages[messages.length - 1].offset;
              await resolveOffset(highestOffset);
            }
            
            const duration = Date.now() - startTime;
            const rate = Math.round(logsToInsert.length / (duration / 1000));
            console.log(`[Webhook] ✅ ${logsToInsert.length} logs in ${duration}ms (${rate}/sec) | Total: ${totalProcessed}`);
          } catch (bulkError) {
            // Only resolve offset for duplicate key errors (E11000)
            if (bulkError.message.includes('E11000')) {
              // Duplicates are expected, resolve offset
              if (messages.length > 0) {
                const highestOffset = messages[messages.length - 1].offset;
                await resolveOffset(highestOffset);
              }
              console.log(`[Webhook] Skipped ${logsToInsert.length} duplicates`);
            } else {
              // Real error - DON'T resolve offset, let Kafka retry
              console.error('[Webhook] Insert failed, will retry:', bulkError.message);
              throw bulkError;
            }
          }
        } else {
          // No logs to insert, resolve offset
          if (messages.length > 0) {
            const highestOffset = messages[messages.length - 1].offset;
            await resolveOffset(highestOffset);
          }
        }
        
        await heartbeat();
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
