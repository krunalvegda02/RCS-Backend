import mongoose from 'mongoose';
import { Kafka } from 'kafkajs';
import { v4 as uuidv4 } from 'uuid';
import connectDB from '../db/index.js';

process.env.WORKER_MODE = 'true';

async function startBatchEntriesConsumer() {
  let consumer;

  try {
    await connectDB();
    console.log('✅ Batch Entries Consumer connected to MongoDB');

    // Handle process exits
    const shutdown = async (signal) => {
      console.log(`🛑 Received ${signal}. Shutting down batch entries consumer...`);
      if (consumer) {
        try {
          await consumer.disconnect();
          console.log('✅ Consumer disconnected');
        } catch (err) {
          console.error('❌ Error disconnecting consumer:', err);
        }
      }
      try {
        await mongoose.connection.close();
        console.log('✅ MongoDB connection closed');
      } catch (err) {
        console.error('❌ Error closing MongoDB connection:', err);
      }
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Catch unhandled errors to prevent silent fail
    process.on('uncaughtException', (err) => {
      console.error('❌ Uncaught Exception:', err);
      shutdown('UNCAUGHT_EXCEPTION');
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
      shutdown('UNHANDLED_REJECTION');
    });

    const kafka = new Kafka({
      clientId: 'batch-entries-consumer',
      brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
      retry: {
        initialRetryTime: 100,
        retries: 8
      },
      requestTimeout: 120000 // 2 minutes for slow operations
    });

    consumer = kafka.consumer({
      groupId: `batch-entries-processor-production-v3`,
      sessionTimeout: 300000,
      heartbeatInterval: 10000,
      maxWaitTimeInMs: 100,
      rebalanceTimeout: 300000
    });

    await consumer.connect();
    console.log('✅ Batch Entries Consumer connected to Kafka');

    await consumer.subscribe({ topic: 'campaign-batch-entries', fromBeginning: false });
    console.log('✅ Batch Entries Consumer subscribed to campaign-batch-entries');

    // Load model dynamically
    const ContactCampaignMessage = (await import('../models/contact_campaign_message.model.js')).default;

    console.log('🚀 Starting consumer run loop...');
    
    // Cache per-user campaign count to avoid repeated queries
    const userCampaignCache = new Map();
    
    await consumer.run({
      partitionsConsumedConcurrently: 3,
      eachBatchAutoResolve: false,
      eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning, isStale }) => {
        console.log(`[BatchConsumer] 📦 Received batch: ${batch.messages.length} messages from partition ${batch.partition}`);
        const messages = batch.messages;
        
        if (messages.length === 0) {
          console.log('[BatchConsumer] ⚠️ Empty batch received');
          await heartbeat();
          return;
        }

        // Process messages sequentially
        const results = [];
        for (const message of messages) {
          if (!isRunning() || isStale()) {
            console.warn('⚠️ Consumer not running or stale, skipping message');
            continue;
          }

          try {
            const batchData = JSON.parse(message.value.toString());
            const { campaignId, templateId, userId, phoneNumbers, totalChunks, chunkIndex } = batchData;

            console.log(`[BatchConsumer] Processing chunk ${chunkIndex + 1}/${totalChunks} (${phoneNumbers.length} contacts) for campaign ${campaignId}`);

            // Build operations - try insert first, update if exists
            const operations = [];
            
            for (const phone of phoneNumbers) {
              const cleanPhone = phone.replace(/^\+?91/, '').replace(/\D/g, '');
              const messageId = uuidv4();

              // Try insert with unique constraint - if fails, it exists
              operations.push({
                insertOne: {
                  document: {
                    recipientPhoneNumber: cleanPhone,
                    userId,
                    campaignIds: [campaignId],
                    campaigns: [{
                      campaignId,
                      templateId,
                      messageId,
                      status: 'pending',
                      queuedAt: new Date(),
                      userClickCount: 0,
                      userReplyCount: 0
                    }]
                  }
                }
              });
            }
            
            console.log(`[BatchConsumer] 📊 Processing ${operations.length} contacts`);

            // Execute inserts - duplicates will fail silently
            let insertCount = 0;
            try {
              const result = await ContactCampaignMessage.bulkWrite(operations, {
                ordered: false,
                writeConcern: { w: 0 } // Fire and forget for speed
              });
              insertCount = result.insertedCount;
              console.log(`[BatchConsumer] ✅ Inserted ${insertCount} new contacts`);
            } catch (err) {
              // Extract successful inserts from error
              if (err.result) {
                insertCount = err.result.nInserted || 0;
                console.log(`[BatchConsumer] ⚠️ Partial insert: ${insertCount} succeeded, ${err.writeErrors?.length || 0} duplicates`);
              } else {
                console.error(`[BatchConsumer] ❌ Insert failed:`, err.message);
              }
            }
            
            // Update existing contacts in small chunks to allow heartbeats
            const updateCount = operations.length - insertCount;
            if (updateCount > 0) {
              console.log(`[BatchConsumer] 🔄 Updating ${updateCount} existing contacts...`);
              const phones = phoneNumbers.map(p => p.replace(/^\+?91/, '').replace(/\D/g, ''));
              const chunkSize = 500;
              let updatedTotal = 0;
              
              for (let i = 0; i < phones.length; i += chunkSize) {
                const phoneChunk = phones.slice(i, i + chunkSize);
                try {
                  const updateResult = await ContactCampaignMessage.updateMany(
                    {
                      recipientPhoneNumber: { $in: phoneChunk },
                      userId
                    },
                    {
                      $push: {
                        campaigns: {
                          campaignId,
                          templateId,
                          messageId: uuidv4(),
                          status: 'pending',
                          queuedAt: new Date(),
                          userClickCount: 0,
                          userReplyCount: 0
                        }
                      },
                      $addToSet: { campaignIds: campaignId }
                    },
                    { writeConcern: { w: 0 } }
                  );
                  updatedTotal += updateResult.modifiedCount || 0;
                  await heartbeat();
                } catch (err) {
                  console.error(`[BatchConsumer] ❌ Update chunk error:`, err.message);
                }
              }
              console.log(`[BatchConsumer] ✅ Updated ${updatedTotal} existing contacts`);
            }
            
            await heartbeat();
            console.log(`[BatchConsumer] ✅ Chunk complete: ${insertCount} inserted, ${updateCount} existing`);

            results.push({ offset: message.offset, campaignId, totalChunks, chunkIndex });
          } catch (error) {
            console.error('[BatchConsumer] ❌ Processing error:', error.message);
            console.error('[BatchConsumer] ❌ Stack:', error.stack);
          }
        }

        // Track chunks in DB (stateless - survives restarts)
        for (const result of results) {
          if (result) {
            const { offset, campaignId, totalChunks, chunkIndex } = result;
            const Campaign = (await import('../models/campaign.model.js')).default;

            // Store chunk completion in DB
            await Campaign.findByIdAndUpdate(
              campaignId,
              { 
                $addToSet: { completedChunks: chunkIndex },
                $set: { totalChunks }
              }
            );

            await resolveOffset(offset);
            
            // Check if campaign completed (read from DB)
            const campaign = await Campaign.findById(campaignId).lean();
            if (campaign && campaign.completedChunks?.length === totalChunks) {
              console.log(`[BatchConsumer] ✅ Campaign ${campaignId}: ALL ${totalChunks} chunks completed`);
              
              // Just update status to pending - stats-consumer will handle counting
              await Campaign.findByIdAndUpdate(
                campaignId,
                {
                  status: 'pending',
                  $unset: { completedChunks: '', totalChunks: '' }
                }
              );
              
              console.log(`[BatchConsumer] 📊 Campaign ${campaignId} status set to pending`);
            }
          }
        }
        await heartbeat();
      }
    });

  } catch (error) {
    console.error('❌ Batch entries consumer CRITICAL ERROR:', error);
    process.exit(1);
  }
}

startBatchEntriesConsumer();
