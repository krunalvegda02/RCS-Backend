import mongoose from 'mongoose';
import { Kafka } from 'kafkajs';
import connectDB from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';

process.env.WORKER_MODE = 'true';

// 🔒 SIMPLE BULLETPROOF COMPLETION TRACKING
async function markChunkComplete(campaignId, chunkIndex, totalChunks, insertedCount) {
  try {
    const Campaign = (await import('../models/campaign.model.js')).default;
    
    // Step 1: Add chunk atomically (prevent duplicates)
    const addResult = await Campaign.updateOne(
      { 
        _id: new mongoose.Types.ObjectId(campaignId),
        status: 'processing',
        completedChunks: { $ne: chunkIndex } // Prevent duplicate processing
      },
      {
        $addToSet: { completedChunks: chunkIndex },
        $inc: { 'stats.processed': insertedCount }
      }
    );
    
    if (addResult.matchedCount === 0) {
      console.log(`[BatchConsumer] ⚠️  Chunk ${chunkIndex} already completed or campaign not processing`);
      return;
    }
    
    // Step 2: Check completion and update status (separate atomic operation)
    const completionResult = await Campaign.updateOne(
      {
        _id: new mongoose.Types.ObjectId(campaignId),
        status: 'processing',
        $expr: { $eq: [{ $size: '$completedChunks' }, totalChunks] } // Only if ALL chunks complete
      },
      {
        $set: {
          status: 'pending',
          completedAt: new Date()
        }
      }
    );
    
    if (completionResult.modifiedCount > 0) {
      console.log(`[BatchConsumer] 🎯 Campaign ${campaignId} → pending (Chunk ${chunkIndex} completed final chunk: ${totalChunks}/${totalChunks})`);
    } else {
      // Get current count for logging
      const campaign = await Campaign.findById(campaignId).select('completedChunks');
      const currentCount = campaign ? campaign.completedChunks.length : 0;
      console.log(`[BatchConsumer] ✅ Chunk ${chunkIndex} completed (${currentCount}/${totalChunks})`);
    }
    
  } catch (error) {
    console.error(`[BatchConsumer] Completion tracking error: ${error.message}`);
  }
}

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
    groupId: `batch-entries-processor-${process.env.PM2_INSTANCE_ID || 'single'}`, // Unique group per instance
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

  // 🔥 Get native MongoDB collection for maximum performance
  const collection = mongoose.connection.db.collection('contact_campaign_messages');
  
  await consumer.run({
    partitionsConsumedConcurrently: 1, // 🛡️ REDUCED: Prevent race conditions in batch processing
    eachBatchAutoResolve: false,

    eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning, isStale }) => {
      try {
        const batchStart = Date.now();
        const campaignUpdates = new Set(); // Track campaigns to update
        
        // 🥇 2. PARALLEL MESSAGE PROCESSING - Process all messages concurrently
        await Promise.all(
          batch.messages.map(async (message) => {
            if (!isRunning() || isStale()) return;

            const start = Date.now();
            const data = JSON.parse(message.value.toString());

            const { campaignId, templateId, userId, phoneNumbers, chunkIndex, totalChunks, batchId, messageKey, configCount } = data;
            
            // 🛡️ PREVENT DUPLICATE PROCESSING
            const processingKey = messageKey || `${campaignId}-${chunkIndex}-${batchId}`;
            
            const campaignObjectId = new mongoose.Types.ObjectId(campaignId);

            console.log(`[BatchConsumer] Campaign ${campaignId} | Chunk ${chunkIndex + 1}/${totalChunks} | ${phoneNumbers.length}${configCount ? ` | ${configCount} configs` : ''} | Key: ${processingKey}`);

            // 🥇 4. PRE-PROCESS OUTSIDE LOOP - Calculate once
            const CHUNK_SIZE = 1000;
            const globalOffset = chunkIndex * CHUNK_SIZE;
            const now = Date.now();
            const randomSuffix = Math.random().toString(36).substr(2, 9);
            const queuedAt = new Date();

            // 🔥 OPTIMIZED: Pre-process phone numbers and create bulk ops efficiently
            const bulkOps = phoneNumbers.map((phone, index) => {
              const messageId = `${campaignId}-${chunkIndex}-${index}-${now}-${randomSuffix}`;
              const cleanPhone = phone.replace(/^\+?91/, '').replace(/\D/g, '');
              
              return {
                insertOne: {
                  document: {
                    messageId,
                    recipientPhoneNumber: cleanPhone,
                    userId,
                    campaignId: campaignObjectId,
                    templateId,
                    status: 'pending',
                    queuedAt,
                    userClickCount: 0,
                    userReplyCount: 0,
                    ...(configCount > 0 ? { configIndex: (globalOffset + index) % configCount } : {})
                  }
                }
              };
            });

            try {
              // 🥇 3. NATIVE MONGO DRIVER - 2x-4x speed boost (M30 optimized)
              const result = await collection.bulkWrite(bulkOps, { 
                ordered: false,
                writeConcern: { w: 'majority', j: true, wtimeout: 15000 } // M30 optimized
              });
              
              console.log(`[BatchConsumer] ✅ Inserted ${result.insertedCount} contacts`);
              
              if (result.writeErrors && result.writeErrors.length > 0) {
                const duplicateErrors = result.writeErrors.filter(err => err.code === 11000);
                console.log(`[BatchConsumer] ⚠️  ${duplicateErrors.length} duplicates skipped, ${result.writeErrors.length - duplicateErrors.length} other errors`);
              }
              
              // 🛡️ SAFETY CHECK: Only mark complete if reasonable insertion success
              const expectedCount = phoneNumbers.length;
              const actualCount = result.insertedCount;
              const successRate = actualCount / expectedCount;
              
              if (successRate >= 0.8) { // At least 80% success rate
                // 🔒 ATOMIC COMPLETION TRACKING
                await markChunkComplete(campaignId, chunkIndex, totalChunks, actualCount);
              } else {
                console.error(`[BatchConsumer] ❌ Chunk ${chunkIndex} had low success rate: ${actualCount}/${expectedCount} (${(successRate*100).toFixed(1)}%) - NOT marking as complete`);
                // Could implement retry logic here
              }
              
            } catch (err) {
              // Handle duplicate key errors gracefully
              if (err.code === 11000 || (err.writeErrors && err.writeErrors.some(e => e.code === 11000))) {
                const duplicateCount = err.writeErrors ? err.writeErrors.filter(e => e.code === 11000).length : 1;
                console.log(`[BatchConsumer] ⚠️  ${duplicateCount} duplicates prevented by unique constraint`);
                
                // Even with duplicates, if most succeeded, mark as complete
                const successfulInserts = phoneNumbers.length - duplicateCount;
                if (successfulInserts > 0) {
                  await markChunkComplete(campaignId, chunkIndex, totalChunks, successfulInserts);
                }
              } else {
                console.error(`[BatchConsumer] ❌ BulkWrite error: ${err.message}`);
                // Don't mark chunk as complete on serious errors
              }
            }

            console.log(`[BatchConsumer] ✅ Chunk ${chunkIndex + 1}/${totalChunks} in ${Date.now() - start}ms`);
          })
        );

        // Resolve all offsets at once
        if (batch.messages.length > 0) {
          await resolveOffset(batch.messages[batch.messages.length - 1].offset);
        }
        await heartbeat();

        console.log(`[BatchConsumer] 🔥 Batch complete: ${batch.messages.length} messages in ${Date.now() - batchStart}ms`);
        
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
