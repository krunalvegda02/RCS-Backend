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

    let totalProcessed = 0;

    await consumer.run({
      partitionsConsumedConcurrently: 4,
      eachBatchAutoResolve: false,
      eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning, isStale }) => {
        const startTime = Date.now();
        const messages = batch.messages;

        console.log(`[WebhookConsumer] Processing batch: ${messages.length} messages`);

        const logsToInsert = [];

        for (const message of messages) {
          if (!isRunning() || isStale()) break;

          try {
            const webhookData = JSON.parse(message.value.toString());
            const data = webhookData.data;

            const messageId = webhookData.messageId ||
              data?.entity?.messageId ||
              data?.messageId ||
              data?.entity?.rcsMessageId ||
              data?.rcsMessageId;

            logsToInsert.push({
              messageId,
              eventType: data?.entityType === 'USER_MESSAGE' ? 'user_interaction' : 'status_update',
              status: 'success',
              webhookData: {
                eventType: data?.entity?.eventType || data?.eventType,
                phoneNumber: data?.userPhoneNumber || data?.entity?.userPhoneNumber,
                interactionType: data?.entityType === 'USER_MESSAGE' ? 'text_reply' : undefined,
                suggestionResponse: data?.entity?.suggestionResponse,
                rawPayload: data
              },
              processed: false,
              timestamp: new Date(webhookData.timestamp),
              metadata: { source: 'webhook' }
            });
          } catch (error) {
            console.error('[WebhookConsumer] Parse error:', error.message);
          }
        }

        let dbSuccess = false;

        if (logsToInsert.length > 0) {
          await heartbeat(); // 🔥 Heartbeat BEFORE DB write
          
          try {
            // Insert in chunks to prevent timeout
            const CHUNK_SIZE = 1000;
            const insertedLogs = [];
            
            for (let i = 0; i < logsToInsert.length; i += CHUNK_SIZE) {
              const chunk = logsToInsert.slice(i, i + CHUNK_SIZE);
              const result = await MessageLog.insertMany(chunk, { 
                ordered: false,
                writeConcern: { w: 1, wtimeout: 10000 }
              });
              insertedLogs.push(...result);
              if (i + CHUNK_SIZE < logsToInsert.length) {
                await heartbeat(); // Heartbeat between chunks
              }
            }
            
            dbSuccess = true;
            totalProcessed += insertedLogs.length;
            const duration = Date.now() - startTime;
            console.log(`[WebhookConsumer] ✅ ${insertedLogs.length} logs processed in ${duration}ms | Total: ${totalProcessed}`);

            if (insertedLogs.length > 0) {
              await heartbeat(); // 🔥 Heartbeat BEFORE Kafka send
              const { sendStatsToKafka } = await import('../services/kafka.service.js');
              const messages = insertedLogs.map(log => ({
                key: log._id.toString(),
                value: JSON.stringify({ logId: log._id.toString() })
              }));
              await sendStatsToKafka(messages, true);
            }
          } catch (bulkError) {
            if (bulkError.message.includes('E11000')) {
              dbSuccess = true;
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
      }
    });

    const shutdown = async () => {
      console.log('🛑 Shutting down webhook consumer...');
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
