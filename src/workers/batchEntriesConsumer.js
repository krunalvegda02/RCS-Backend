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
      groupId: `batch-entries-processor-v3-${process.env.NODE_ENV || 'dev'}`, // New group to skip old messages
      sessionTimeout: 300000, // 5 minutes
      heartbeatInterval: 10000, // 10 seconds
      maxWaitTimeInMs: 100,
      rebalanceTimeout: 300000 // 5 minutes
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

            // Phase 1: Collect all phones
            const cleanPhones = phoneNumbers.map(phone => phone.replace(/^\+?91/, '').replace(/\D/g, ''));
            
            // Phase 2: Check if first campaign (cached to avoid repeated queries)
            const Campaign = (await import('../models/campaign.model.js')).default;
            const userIdStr = userId.toString();
            
            if (!userCampaignCache.has(userIdStr)) {
              const campaignCount = await Campaign.countDocuments({ userId });
              userCampaignCache.set(userIdStr, campaignCount === 1);
            }
            const isFirstCampaign = userCampaignCache.get(userIdStr);
            
            const contactMap = new Map();
            
            if (!isFirstCampaign) {
              const QUERY_CHUNK_SIZE = 100;
              for (let i = 0; i < cleanPhones.length; i += QUERY_CHUNK_SIZE) {
                const phoneChunk = cleanPhones.slice(i, i + QUERY_CHUNK_SIZE);
                const existingContacts = await ContactCampaignMessage.find({
                  recipientPhoneNumber: { $in: phoneChunk },
                  userId
                }).lean();
                
                existingContacts.forEach(contact => {
                  contactMap.set(contact.recipientPhoneNumber, contact);
                });
              }
            } else {
              console.log(`[BatchConsumer] ⚡ First campaign - skipping queries, all inserts`);
            }

            // Phase 3: Build bulk operations - SEPARATE inserts and updates
            const insertOps = [];
            const updateOps = [];

            for (const phone of phoneNumbers) {
              const cleanPhone = phone.replace(/^\+?91/, '').replace(/\D/g, '');
              const messageId = uuidv4();
              const existingContact = contactMap.get(cleanPhone);

              if (!existingContact) {
                insertOps.push({
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
              } else {
                updateOps.push({
                  updateOne: {
                    filter: {
                      recipientPhoneNumber: cleanPhone,
                      userId,
                      'campaigns.campaignId': { $ne: new mongoose.Types.ObjectId(campaignId) }
                    },
                    update: {
                      $push: {
                        campaigns: {
                          campaignId,
                          templateId,
                          messageId,
                          status: 'pending',
                          queuedAt: new Date(),
                          userClickCount: 0,
                          userReplyCount: 0
                        }
                      },
                      $addToSet: { campaignIds: campaignId }
                    }
                  }
                });
              }
            }

            // Phase 4: Execute inserts first (faster), then updates
            const BULK_WRITE_BATCH_SIZE = 1000; // Increased for faster throughput
            let successCount = 0;
            let modifiedCount = 0;

            // Execute inserts
            if (insertOps.length > 0) {
              console.log(`[BatchConsumer] 📝 Inserting ${insertOps.length} new contacts`);
              for (let i = 0; i < insertOps.length; i += BULK_WRITE_BATCH_SIZE) {
                const chunk = insertOps.slice(i, i + BULK_WRITE_BATCH_SIZE);
                try {
                  const result = await ContactCampaignMessage.bulkWrite(chunk, {
                    ordered: false,
                    writeConcern: { w: 1, j: false }
                  });
                  successCount += result.insertedCount;
                  await heartbeat();
                } catch (err) {
                  console.error(`[BatchConsumer] ❌ Insert error:`, err.message);
                }
              }
            }

            // Execute updates
            if (updateOps.length > 0) {
              console.log(`[BatchConsumer] 🔄 Updating ${updateOps.length} existing contacts`);
              for (let i = 0; i < updateOps.length; i += BULK_WRITE_BATCH_SIZE) {
                const chunk = updateOps.slice(i, i + BULK_WRITE_BATCH_SIZE);
                try {
                  const result = await ContactCampaignMessage.bulkWrite(chunk, {
                    ordered: false,
                    writeConcern: { w: 1, j: false }
                  });
                  modifiedCount += result.modifiedCount;
                  await heartbeat();
                } catch (err) {
                  console.error(`[BatchConsumer] ❌ Update error:`, err.message);
                }
              }
            }

            console.log(`[BatchConsumer] 💾 Summary: inserted=${successCount}, modified=${modifiedCount}`);

            results.push({ offset: message.offset, campaignId, totalChunks, chunkIndex });
          } catch (error) {
            console.error('[BatchConsumer] ❌ Processing error:', error.message);
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
              
              // Run stats update async
              setImmediate(async () => {
                try {
                  const aggregatedStats = await ContactCampaignMessage.aggregate([
                    { $match: { 'campaigns.campaignId': new mongoose.Types.ObjectId(campaignId) } },
                    { $unwind: '$campaigns' },
                    { $match: { 'campaigns.campaignId': new mongoose.Types.ObjectId(campaignId) } },
                    {
                      $group: {
                        _id: null,
                        total: { $sum: 1 },
                        pending: { $sum: { $cond: [{ $in: ['$campaigns.status', ['pending', 'draft', 'queued']] }, 1, 0] } }
                      }
                    }
                  ]);

                  const stats = aggregatedStats[0] || { total: 0, pending: 0 };

                  await Campaign.findByIdAndUpdate(
                    campaignId,
                    {
                      status: 'pending',
                      'stats.total': stats.total,
                      'stats.pending': stats.pending,
                      $unset: { completedChunks: '', totalChunks: '' }
                    }
                  );

                  console.log(`[BatchConsumer] 📊 Campaign ${campaignId} stats synced: total=${stats.total}`);
                } catch (err) {
                  console.error(`[BatchConsumer] ❌ Stats sync error:`, err.message);
                }
              });
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
