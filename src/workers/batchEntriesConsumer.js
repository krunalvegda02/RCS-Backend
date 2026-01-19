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
      }
    });

    consumer = kafka.consumer({
      groupId: `batch-entries-processor-${process.env.NODE_ENV || 'dev'}`,
      sessionTimeout: 300000,
      heartbeatInterval: 3000,
      maxWaitTimeInMs: 100,
      rebalanceTimeout: 300000
    });

    await consumer.connect();
    console.log('✅ Batch Entries Consumer connected to Kafka');

    await consumer.subscribe({ topic: 'campaign-batch-entries', fromBeginning: false });
    console.log('✅ Batch Entries Consumer subscribed to campaign-batch-entries');

    // Load model dynamically
    const ContactCampaignMessage = (await import('../models/contact_campaign_message.model.js')).default;

    const campaignChunks = new Map(); // Track: campaignId -> { total, completed: Set() }

    console.log('🚀 Starting consumer run loop...');
    await consumer.run({
      partitionsConsumedConcurrently: 1,
      eachBatchAutoResolve: false,
      eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning, isStale }) => {
        const messages = batch.messages;

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

            // Map phone numbers for query
            const cleanPhones = phoneNumbers.map(phone => phone.replace(/^\+?91/, '').replace(/\D/g, ''));
            const existingContacts = await ContactCampaignMessage.find({
              recipientPhoneNumber: { $in: cleanPhones },
              userId
            }).lean();

            const contactMap = new Map();
            existingContacts.forEach(contact => {
              contactMap.set(contact.recipientPhoneNumber, contact);
            });

            const bulkOps = [];

            for (const phone of phoneNumbers) {
              const cleanPhone = phone.replace(/^\+?91/, '').replace(/\D/g, '');
              const messageId = uuidv4();
              const existingContact = contactMap.get(cleanPhone);

              if (!existingContact) {
                bulkOps.push({
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
                bulkOps.push({
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

            // Chunk the bulk writes to avoid timeouts
            const BULK_WRITE_BATCH_SIZE = 500;
            const totalOps = bulkOps.length;
            let processedOps = 0;
            let successCount = 0;
            let modifiedCount = 0;

            if (totalOps > 0) {
              console.log(`[BatchConsumer] 📝 Splitting ${totalOps} operations into batches of ${BULK_WRITE_BATCH_SIZE}`);

              for (let i = 0; i < totalOps; i += BULK_WRITE_BATCH_SIZE) {
                const chunkOps = bulkOps.slice(i, i + BULK_WRITE_BATCH_SIZE);
                try {
                  const dbStart = Date.now();
                  const result = await ContactCampaignMessage.bulkWrite(chunkOps, {
                    ordered: false,
                    writeConcern: { w: 1, j: false }
                  });
                  const dbDuration = Date.now() - dbStart;

                  successCount += result.insertedCount;
                  modifiedCount += result.modifiedCount;
                  processedOps += chunkOps.length;

                  // Critical: Heartbeat after each mini-batch
                  await heartbeat();

                  if ((i + BULK_WRITE_BATCH_SIZE < totalOps) || dbDuration > 1000) {
                    console.log(`[BatchConsumer] ... processed batch ${Math.floor(i / BULK_WRITE_BATCH_SIZE) + 1} (${chunkOps.length} ops) in ${dbDuration}ms`);
                  }

                } catch (chunkError) {
                  console.error(`[BatchConsumer] ❌ Batch BulkWrite error (idx ${i}):`, chunkError.message);
                  // If we lost Kafka connection, there's no point continuing the loop as we can't notify
                  if (chunkError.message.includes('rebalancing') || chunkError.message.includes('not aware of this member')) {
                    throw chunkError;
                  }
                }
              }
              console.log(`[BatchConsumer] 💾 BulkWrite summary: inserted=${successCount}, modified=${modifiedCount}`);
            } else {
              console.log(`[BatchConsumer] ⚠️ No bulk operations needed (all exist)`);
            }

            results.push({ offset: message.offset, campaignId, totalChunks, chunkIndex });
          } catch (error) {
            console.error('[BatchConsumer] ❌ Processing error:', error.message);
          }
        }

        // Track chunks and update status
        for (const result of results) {
          if (result) {
            const { offset, campaignId, totalChunks, chunkIndex } = result;

            const campaignKey = campaignId.toString();
            if (!campaignChunks.has(campaignKey)) {
              campaignChunks.set(campaignKey, { total: totalChunks, completed: new Set() });
            }
            campaignChunks.get(campaignKey).completed.add(chunkIndex);

            await resolveOffset(offset);
          }
        }

        // Check completions
        for (const [campaignKey, progress] of campaignChunks.entries()) {
          console.log(`[BatchConsumer] 🔍 Campaign ${campaignKey}: ${progress.completed.size}/${progress.total} chunks completed`);

          if (progress.completed.size === progress.total) {
            const Campaign = (await import('../models/campaign.model.js')).default;

            const contactCount = await ContactCampaignMessage.countDocuments({
              'campaigns.campaignId': new mongoose.Types.ObjectId(campaignKey)
            });

            console.log(`[BatchConsumer] 📊 Campaign ${campaignKey}: ${contactCount} contacts in database`);

            const aggregatedStats = await ContactCampaignMessage.aggregate([
              { $match: { 'campaigns.campaignId': new mongoose.Types.ObjectId(campaignKey) } },
              { $unwind: '$campaigns' },
              { $match: { 'campaigns.campaignId': new mongoose.Types.ObjectId(campaignKey) } },
              {
                $group: {
                  _id: null,
                  total: { $sum: 1 },
                  pending: { $sum: { $cond: [{ $in: ['$campaigns.status', ['pending', 'draft', 'queued']] }, 1, 0] } },
                  sent: { $sum: { $cond: [{ $eq: ['$campaigns.status', 'sent'] }, 1, 0] } },
                  delivered: { $sum: { $cond: [{ $eq: ['$campaigns.status', 'delivered'] }, 1, 0] } },
                  read: { $sum: { $cond: [{ $eq: ['$campaigns.status', 'read'] }, 1, 0] } },
                  replied: { $sum: { $cond: [{ $eq: ['$campaigns.status', 'replied'] }, 1, 0] } },
                  failed: { $sum: { $cond: [{ $in: ['$campaigns.status', ['failed', 'bounced', 'expired']] }, 1, 0] } }
                }
              }
            ]);

            const stats = aggregatedStats[0] || { total: 0, pending: 0, sent: 0, delivered: 0, read: 0, replied: 0, failed: 0 };

            await Campaign.findByIdAndUpdate(
              campaignKey,
              {
                status: 'pending',
                'stats.total': stats.total,
                'stats.pending': stats.pending,
                'stats.sent': stats.sent,
                'stats.delivered': stats.delivered,
                'stats.read': stats.read,
                'stats.replied': stats.replied,
                'stats.failed': stats.failed,
                'stats.bounced': 0
              },
              { new: true }
            );

            console.log(`[BatchConsumer] ✅✅✅ Campaign ${campaignKey} ALL chunks completed & stats updated`);
            await heartbeat();
            campaignChunks.delete(campaignKey);
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
