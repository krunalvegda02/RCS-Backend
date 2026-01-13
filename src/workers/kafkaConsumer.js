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
    
    // 🔥 OPTIMIZATION: In-memory cache for messageId → userId/campaignId
    const messageCache = new Map();
    let lastCacheRefresh = Date.now();
    const CACHE_REFRESH_INTERVAL = 60000;
    
    // Helper for namespaced cache keys
    const getCacheKey = (type, id) => `${type}:${id}`;
    
    await consumer.run({
      partitionsConsumedConcurrently: 4, // 🔥 FIX #3: Reduced from 20 to prevent rebalancing
      eachBatchAutoResolve: false,
      eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning, isStale }) => {
        const startTime = Date.now();
        const messages = batch.messages;
        
        console.log(`[KafkaConsumer] Processing batch: ${messages.length} messages from partition ${batch.partition}`);
        
        // 🔥 FIX #1: Parse all webhooks WITHOUT ACKing on error
        const parsedData = [];
        const invalidOffsets = [];
        
        for (const message of messages) {
          if (!isRunning() || isStale()) break;
          
          try {
            const webhookData = JSON.parse(message.value.toString());
            const data = webhookData.data;
            
            // 🔥 Extract messageId from all possible locations
            const messageId = data?.entity?.messageId || 
                            data?.messageId || 
                            data?.entity?.rcsMessageId ||
                            data?.rcsMessageId;
            
            // 🔥 DEBUG: Log webhook structure every 10 messages
            if (parsedData.length % 10 === 0) {
              console.log('[KafkaConsumer] Webhook structure:', JSON.stringify({
                extractedMessageId: messageId,
                'data.entity.messageId': data?.entity?.messageId,
                'data.messageId': data?.messageId,
                'data.entity.rcsMessageId': data?.entity?.rcsMessageId,
                'data.rcsMessageId': data?.rcsMessageId,
                eventType: data?.entity?.eventType || data?.eventType,
                entityType: data?.entityType
              }, null, 2));
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
            invalidOffsets.push(message.offset);
          }
        }
        
        const messageIds = parsedData.map(p => p.messageId).filter(Boolean);
        if (messageIds.length === 0) {
          console.log(`[KafkaConsumer] No valid messageIds in batch, skipping`);
          await heartbeat();
          return;
        }
        
        console.log(`[KafkaConsumer] Found ${messageIds.length} valid messageIds to process`);
        
        // 🔥 STEP 2: Check cache first, only query DB for missing IDs
        const uncachedIds = [];
        const messageMap = {};
        
        for (const id of messageIds) {
          const msgKey = getCacheKey('msg', id);
          const jioKey = getCacheKey('jio', id);
          const rcsKey = getCacheKey('rcs', id);
          
          if (messageCache.has(msgKey)) {
            messageMap[id] = messageCache.get(msgKey);
          } else if (messageCache.has(jioKey)) {
            messageMap[id] = messageCache.get(jioKey);
          } else if (messageCache.has(rcsKey)) {
            messageMap[id] = messageCache.get(rcsKey);
          } else {
            uncachedIds.push(id);
          }
        }
        
        // 🔥 STEP 3: Batch query ONLY uncached messageIds
        if (uncachedIds.length > 0) {
          console.log(`[KafkaConsumer] Querying DB for ${uncachedIds.length} uncached messageIds...`);
          
          const messageDocs = await ContactCampaignMessage.find({
            $or: [
              { 'campaigns.messageId': { $in: uncachedIds } },
              { 'campaigns.jioMessageId': { $in: uncachedIds } },
              { 'campaigns.rcsMessageId': { $in: uncachedIds } }
            ]
          }, { userId: 1, campaigns: 1 }).lean();
          
          console.log(`[KafkaConsumer] Found ${messageDocs.length} documents in DB for ${uncachedIds.length} messageIds`);
          
          // 🔥 BUG FIX #2: Heartbeat during long operations
          await heartbeat();
          
          let matchedCount = 0;
          messageDocs.forEach(doc => {
            doc.campaigns?.forEach(camp => {
              const info = { userId: doc.userId, campaignId: camp.campaignId };
              if (camp.messageId) {
                messageMap[camp.messageId] = info;
                messageCache.set(getCacheKey('msg', camp.messageId), info);
                if (uncachedIds.includes(camp.messageId)) matchedCount++;
              }
              if (camp.jioMessageId) {
                messageMap[camp.jioMessageId] = info;
                messageCache.set(getCacheKey('jio', camp.jioMessageId), info);
                if (uncachedIds.includes(camp.jioMessageId)) matchedCount++;
              }
              if (camp.rcsMessageId) {
                messageMap[camp.rcsMessageId] = info;
                messageCache.set(getCacheKey('rcs', camp.rcsMessageId), info);
                if (uncachedIds.includes(camp.rcsMessageId)) matchedCount++;
              }
            });
          });
          
          console.log(`[KafkaConsumer] Matched ${matchedCount} messageIds from DB query`);
          
          // 🔥 DEBUG: Log first 3 unmatched IDs with sample DB data
          const unmatchedIds = uncachedIds.filter(id => !messageMap[id]);
          if (unmatchedIds.length > 0) {
            console.log(`[KafkaConsumer] ⚠️ ${unmatchedIds.length} messageIds NOT found in DB. Examples: ${unmatchedIds.slice(0, 3).join(', ')}`);
            
            // Show what messageIds ARE in the DB for comparison
            if (messageDocs.length > 0) {
              const sampleDbIds = messageDocs.slice(0, 2).map(doc => ({
                messageId: doc.campaigns?.[0]?.messageId,
                jioMessageId: doc.campaigns?.[0]?.jioMessageId,
                rcsMessageId: doc.campaigns?.[0]?.rcsMessageId
              }));
              console.log('[KafkaConsumer] Sample DB messageIds:', JSON.stringify(sampleDbIds, null, 2));
            } else {
              // No docs found - check if ANY campaigns exist in DB
              const totalCampaigns = await ContactCampaignMessage.countDocuments();
              console.log(`[KafkaConsumer] ⚠️ No matching docs found. Total campaigns in DB: ${totalCampaigns}`);
              
              if (totalCampaigns > 0) {
                // Show sample of what's actually in DB
                const sample = await ContactCampaignMessage.findOne({}, { userId: 1, campaigns: 1 }).lean();
                if (sample?.campaigns?.[0]) {
                  console.log('[KafkaConsumer] Sample campaign from DB:', JSON.stringify({
                    messageId: sample.campaigns[0].messageId,
                    jioMessageId: sample.campaigns[0].jioMessageId,
                    rcsMessageId: sample.campaigns[0].rcsMessageId,
                    status: sample.campaigns[0].status
                  }, null, 2));
                }
              }
            }
          }
        } else {
          console.log(`[KafkaConsumer] All ${messageIds.length} messageIds found in cache`);
        }
        
        // 🔥 STEP 4: Build logs array (fast)
        const logsToInsert = [];
        let skippedCount = 0;
        
        console.log(`[KafkaConsumer] Building logs from ${parsedData.length} parsed messages...`);
        
        for (const parsed of parsedData) {
          const msgInfo = messageMap[parsed.messageId];
          if (msgInfo?.userId) {
            logsToInsert.push({
              messageId: parsed.messageId,
              campaignId: new mongoose.Types.ObjectId(msgInfo.campaignId),
              userId: new mongoose.Types.ObjectId(msgInfo.userId),
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
        
        // 🔥 FIX: Safe ACK pattern - only ACK after successful DB insert
        let dbSuccess = false;
        
        if (logsToInsert.length > 0) {
          try {
            await MessageLog.insertMany(logsToInsert, { ordered: false });
            dbSuccess = true;
            totalProcessed += logsToInsert.length;
            const duration = Date.now() - startTime;
            const rate = Math.round(logsToInsert.length / (duration / 1000));
            console.log(`[KafkaConsumer] ✅ ${logsToInsert.length} logs in ${duration}ms (${rate}/sec) | Skipped: ${skippedCount} | Total: ${totalProcessed}`);
          } catch (bulkError) {
            if (bulkError.message.includes('E11000')) {
              dbSuccess = true; // Duplicates are OK
            } else {
              console.error('[Kafka] ❌ DB FAILED - NOT ACKING:', bulkError.message);
            }
          }
        } else {
          dbSuccess = true;
          console.log(`[KafkaConsumer] No logs to insert (all ${skippedCount} messages skipped - no matching messageIds in DB)`);
        }
        
        // 🔥 BUG FIX #1: Resolve last offset only (batch commit)
        if (dbSuccess && messages.length > 0) {
          await resolveOffset(messages[messages.length - 1].offset);
        }
        
        // 🔥 BUG FIX #2: Heartbeat to prevent session timeout
        await heartbeat();
        
        // 🔥 Cache cleanup with LRU-style eviction
        if (Date.now() - lastCacheRefresh > CACHE_REFRESH_INTERVAL) {
          if (messageCache.size > 100000) {
            // Evict 20% oldest entries instead of clearing all
            const entriesToDelete = Math.floor(messageCache.size * 0.2);
            let deleted = 0;
            for (const key of messageCache.keys()) {
              messageCache.delete(key);
              if (++deleted >= entriesToDelete) break;
            }
            console.log(`[KafkaConsumer] Cache pruned: ${deleted} entries removed`);
          }
          lastCacheRefresh = Date.now();
        }
      }
    });

    const shutdown = async () => {
      console.log('🛑 Shutting down Kafka consumer...');
      messageCache.clear();
      await disconnectKafka();
      await mongoose.connection.close();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

  } catch (error) {
    console.error('❌ Kafka consumer startup failed:', error);
    process.exit(1);
  }
}

startKafkaConsumer();
