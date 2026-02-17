import mongoose from 'mongoose';
import { Kafka } from 'kafkajs';
import connectDB from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';

process.env.WORKER_MODE = 'true';

async function startBatchEntriesConsumer() {
  await connectDB();
  console.log('✅ MongoDB connected');

  const kafka = new Kafka({
    clientId: 'batch-entries-consumer',
    brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
    connectionTimeout: 30000,
    requestTimeout: 30000,
    retry: {
      initialRetryTime: 300,
      retries: 5,
      maxRetryTime: 30000,
      multiplier: 2
    }
  });

  const consumer = kafka.consumer({
    groupId: 'batch-entries-processor-prod-final',
    sessionTimeout: 120000,
    heartbeatInterval: 10000,
    rebalanceTimeout: 120000,
    retry: {
      initialRetryTime: 300,
      retries: 5,
      maxRetryTime: 30000,
      multiplier: 2
    }
  });

  const ContactCampaignMessage = (await import('../models/contactMessage.model.js')).default;
  const Campaign = (await import('../models/campaign.model.js')).default;

  let isConnected = false;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 10;

  const connect = async () => {
    try {
      console.log('🔄 Connecting to Kafka...');
      await consumer.connect();
      await consumer.subscribe({ topic: 'campaign-batch-entries', fromBeginning: false });
      console.log('✅ Subscribed to campaign-batch-entries');
      isConnected = true;
      reconnectAttempts = 0;
    } catch (error) {
      console.error('❌ Connection failed:', error.message);
      reconnectAttempts++;

      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
        console.log(`⏳ Retrying in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return connect();
      } else {
        console.error('❌ Max reconnection attempts reached. Exiting.');
        process.exit(1);
      }
    }
  };

  await connect();

  // Handle consumer crashes and reconnect
  consumer.on(consumer.events.CRASH, async (event) => {
    console.error('❌ Consumer crashed:', event.payload.error.message);
    isConnected = false;

    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      console.log('🔄 Attempting to reconnect...');
      await connect();
    } else {
      console.error('❌ Max reconnection attempts reached after crash. Exiting.');
      process.exit(1);
    }
  });

  consumer.on(consumer.events.DISCONNECT, () => {
    console.log('⚠️ Consumer disconnected');
    isConnected = false;
  });

  consumer.on(consumer.events.CONNECT, () => {
    console.log('✅ Consumer connected');
    isConnected = true;
  });

  await consumer.run({
    partitionsConsumedConcurrently: 1,
    eachBatchAutoResolve: false,

    eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning, isStale }) => {
      try {
        for (const message of batch.messages) {
          if (!isRunning() || isStale()) break;

          const start = Date.now();
          const data = JSON.parse(message.value.toString());

          const { campaignId, templateId, userId, phoneNumbers, chunkIndex, totalChunks, batchId, configCount } = data;
          const campaignObjectId = new mongoose.Types.ObjectId(campaignId);

          console.log(`[BatchConsumer] Campaign ${campaignId} | Chunk ${chunkIndex + 1}/${totalChunks} | ${phoneNumbers.length}${configCount ? ` | ${configCount} configs` : ''}`);

          // Calculate global offset: sum of all previous chunks (each chunk is 1000 except possibly the last)
          const CHUNK_SIZE = 1000;
          const globalOffset = chunkIndex * CHUNK_SIZE;

          const docs = phoneNumbers.map((phone, index) => {
            const messageId = `${campaignId}-${chunkIndex}-${index}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            return {
              messageId,
              recipientPhoneNumber: phone.replace(/^\+?91/, '').replace(/\D/g, ''),
              userId,
              campaignId: campaignObjectId,
              templateId,
              status: 'pending',
              queuedAt: new Date(),
              userClickCount: 0,
              userReplyCount: 0,
              ...(configCount > 0 ? { configIndex: (globalOffset + index) % configCount } : {})
            };
          });

          try {
            const result = await ContactCampaignMessage.insertMany(docs, { ordered: false });
            console.log(`[BatchConsumer] Inserted ${result.length} contacts`);
          } catch (err) {
            if (err.writeErrors) {
              console.error(`[BatchConsumer] ${err.writeErrors.length} duplicates skipped, ${docs.length - err.writeErrors.length} inserted`);
            } else {
              console.error(`[BatchConsumer] Insert error: ${err.message}`);
            }
          }

          // Update to pending if last chunk
          if (chunkIndex === totalChunks - 1) {
            await Campaign.updateOne(
              { _id: campaignObjectId },
              { status: 'pending' }
            );
            console.log(`[BatchConsumer] 🎯 Campaign ${campaignId} → pending`);
          }

          await resolveOffset(message.offset);
          await heartbeat();

          console.log(`[BatchConsumer] ✅ Chunk ${chunkIndex + 1}/${totalChunks} in ${Date.now() - start}ms`);
        }
      } catch (error) {
        console.error('[BatchConsumer] Batch processing error:', error.message);
        // Don't throw - let consumer continue with next batch
      }
    }
  });

  const shutdown = async () => {
    console.log('🛑 Shutting down consumer gracefully...');
    isConnected = false;
    try {
      await consumer.disconnect();
      await mongoose.connection.close();
      console.log('✅ Shutdown complete');
      process.exit(0);
    } catch (error) {
      console.error('❌ Shutdown error:', error.message);
      process.exit(1);
    }
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught exception:', error.message);
    shutdown();
  });
  process.on('unhandledRejection', (reason) => {
    console.error('❌ Unhandled rejection:', reason);
    shutdown();
  });
}

startBatchEntriesConsumer();
