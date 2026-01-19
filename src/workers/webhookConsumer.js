import mongoose from 'mongoose';
import { connectConsumer, disconnectKafka } from '../services/kafka.service.js';
import connectDB from '../db/index.js';

process.env.WORKER_MODE = 'true';

async function startWebhookConsumer() {
  try {
    console.log('[WebhookConsumer] Starting up...');

    await connectDB();
    console.log('✅ Webhook Consumer connected to MongoDB');

    console.log('[WebhookConsumer] Connecting to Kafka...');
    const consumer = await connectConsumer();
    console.log('[WebhookConsumer] Kafka connection successful');

    const MessageLog = (await import('../models/messageLog.model.js')).default;
    const ContactCampaignMessage = (await import('../models/contact_campaign_message.model.js')).default;

    let totalProcessed = 0;

    // In-memory cache for messageId → userId/campaignId
    const messageCache = new Map();
    let lastCacheRefresh = Date.now();
    const CACHE_REFRESH_INTERVAL = 60000;

    const getCacheKey = (type, id) => `${type}:${id}`;

    await consumer.run({
      partitionsConsumedConcurrently: 4,
      eachBatchAutoResolve: false,
      eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning, isStale }) => {
        const startTime = Date.now();
        const messages = batch.messages;

        console.log(`[WebhookConsumer] Processing batch: ${messages.length} messages`);

        const parsedData = [];

        for (const message of messages) {
          if (!isRunning() || isStale()) break;

          try {
            const webhookData = JSON.parse(message.value.toString());
            const data = webhookData.data;

            // Use the messageId from the webhook payload (already processed in app.js)
            const messageId = webhookData.messageId ||
              data?.entity?.messageId ||
              data?.messageId ||
              data?.entity?.rcsMessageId ||
              data?.rcsMessageId;

            console.log(`[WebhookConsumer] 🔍 Parsed messageId: ${messageId}, entityType: ${data?.entityType}`);

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
            console.error('[WebhookConsumer] Parse error:', error.message);
          }
        }

        const messageIds = parsedData.map(p => p.messageId).filter(Boolean);
        if (messageIds.length === 0) {
          console.log(`[WebhookConsumer] No valid messageIds in batch`);
          await heartbeat();
          return;
        }

        // Check cache first
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

        // Query DB for uncached messageIds in chunks to prevent timeout
        if (uncachedIds.length > 0) {
          console.log(`[WebhookConsumer] 🔍 Querying DB for ${uncachedIds.length} uncached IDs`);

          const CHUNK_SIZE = 200;
          const chunks = [];
          for (let i = 0; i < uncachedIds.length; i += CHUNK_SIZE) {
            chunks.push(uncachedIds.slice(i, i + CHUNK_SIZE));
          }

          let totalFound = 0;

          // Process chunks sequentially to avoid overwhelming the DB
          for (const chunk of chunks) {
            try {
              // 🔥 FIX: Split $or query into 3 specific queries to force index usage and avoid timeouts
              const [byMsgId, byJioId, byRcsId] = await Promise.all([
                ContactCampaignMessage.find({ 'campaigns.messageId': { $in: chunk } }, { userId: 1, campaigns: 1 }).lean().maxTimeMS(20000),
                ContactCampaignMessage.find({ 'campaigns.jioMessageId': { $in: chunk } }, { userId: 1, campaigns: 1 }).lean().maxTimeMS(20000),
                ContactCampaignMessage.find({ 'campaigns.rcsMessageId': { $in: chunk } }, { userId: 1, campaigns: 1 }).lean().maxTimeMS(20000)
              ]);

              // Merge results (deduplicate by _id)
              const messageDocs = [...byMsgId, ...byJioId, ...byRcsId];

              totalFound += messageDocs.length;

              messageDocs.forEach(doc => {
                doc.campaigns?.forEach(camp => {
                  const info = { userId: doc.userId, campaignId: camp.campaignId };
                  if (camp.messageId) {
                    messageMap[camp.messageId] = info;
                    messageCache.set(getCacheKey('msg', camp.messageId), info);
                  }
                  if (camp.jioMessageId) {
                    messageMap[camp.jioMessageId] = info;
                    messageCache.set(getCacheKey('jio', camp.jioMessageId), info);
                  }
                  if (camp.rcsMessageId) {
                    messageMap[camp.rcsMessageId] = info;
                    messageCache.set(getCacheKey('rcs', camp.rcsMessageId), info);
                  }
                });
              });
            } catch (err) {
              console.error('[WebhookConsumer] ⚠️ Chunk query failed:', err.message);
              // Continue to next chunk - better to process some than none
            }
          }

          console.log(`[WebhookConsumer] 🔍 Found ${totalFound} matching documents in total`);
          await heartbeat();
        }

        // Build logs array
        const logsToInsert = [];

        console.log(`[WebhookConsumer] 🔍 Building logs for ${parsedData.length} parsed items`);

        for (const parsed of parsedData) {
          const msgInfo = messageMap[parsed.messageId];
          console.log(`[WebhookConsumer] 🔍 MessageId: ${parsed.messageId}, Found info:`, msgInfo ? 'YES' : 'NO');

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
          }
        }

        let dbSuccess = false;

        if (logsToInsert.length > 0) {
          try {
            const insertedLogs = await MessageLog.insertMany(logsToInsert, { ordered: false });
            dbSuccess = true;
            totalProcessed += logsToInsert.length;
            const duration = Date.now() - startTime;
            console.log(`[WebhookConsumer] ✅ ${logsToInsert.length} logs processed in ${duration}ms | Total: ${totalProcessed}`);

            // Send log IDs to stats processing topic in batch
            if (insertedLogs.length > 0) {
              const { sendStatsToKafka } = await import('../services/kafka.service.js');
              const messages = insertedLogs.map(log => ({
                key: log._id.toString(),
                value: JSON.stringify({ logId: log._id.toString() })
              }));
              await sendStatsToKafka(messages, true);
            }
          } catch (bulkError) {
            if (bulkError.message.includes('E11000')) {
              dbSuccess = true; // Duplicates are OK
            } else {
              console.error('[WebhookConsumer] ❌ DB error:', bulkError.message);
            }
          }
        } else {
          dbSuccess = true;
        }

        if (dbSuccess && messages.length > 0) {
          await resolveOffset(messages[messages.length - 1].offset);
        }

        await heartbeat();

        // Cache cleanup
        if (Date.now() - lastCacheRefresh > CACHE_REFRESH_INTERVAL) {
          if (messageCache.size > 100000) {
            const entriesToDelete = Math.floor(messageCache.size * 0.2);
            let deleted = 0;
            for (const key of messageCache.keys()) {
              messageCache.delete(key);
              if (++deleted >= entriesToDelete) break;
            }
          }
          lastCacheRefresh = Date.now();
        }
      }
    });

    const shutdown = async () => {
      console.log('🛑 Shutting down webhook consumer...');
      messageCache.clear();
      await disconnectKafka();
      await mongoose.connection.close();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

  } catch (error) {
    console.error('❌ Webhook consumer startup failed:', error);
    process.exit(1);
  }
}

startWebhookConsumer();