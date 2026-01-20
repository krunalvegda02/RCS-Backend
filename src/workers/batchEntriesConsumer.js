// import mongoose from 'mongoose';
// import { Kafka } from 'kafkajs';
// import connectDB from '../db/index.js';

// process.env.WORKER_MODE = 'true';

// async function startBatchEntriesConsumer() {
//   try {
//     await connectDB();
//     console.log('✅ Batch Entries Consumer connected to MongoDB');

//     const kafka = new Kafka({
//       clientId: 'batch-entries-consumer',
//       brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
//       retry: {
//         initialRetryTime: 100,
//         retries: 8
//       }
//     });

//     const consumer = kafka.consumer({
//       groupId: `batch-entries-processor-production-v3`,
//       sessionTimeout: 600000, // 10 minutes
//       heartbeatInterval: 3000 // 3 seconds
//     });

//     await consumer.connect();
//     await consumer.subscribe({ topic: 'campaign-batch-entries', fromBeginning: false });
//     console.log('✅ Batch Entries Consumer subscribed to campaign-batch-entries');

//     const ContactCampaignMessage = (await import('../models/contact_campaign_message.model.js')).default;

//     let totalProcessed = 0;
//     const campaignChunks = new Map();

//     await consumer.run({
//       partitionsConsumedConcurrently: 3,
//       eachBatchAutoResolve: false,
//       eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning, isStale }) => {
//         const startTime = Date.now();
//         const messages = batch.messages;
//         const { v4: uuidv4 } = await import('uuid');

//         const processPromises = messages.map(async (message) => {
//           if (!isRunning() || isStale()) return null;

//           try {
//             const batchData = JSON.parse(message.value.toString());
//             const { campaignId, templateId, userId, phoneNumbers, totalChunks, chunkIndex } = batchData;

//             console.log(`[BatchConsumer] Processing chunk ${chunkIndex + 1}/${totalChunks} (${phoneNumbers.length} contacts) for campaign ${campaignId}`);

//             const bulkOps = phoneNumbers.map(phone => {
//               const cleanPhone = phone.replace(/^\+?91/, '').replace(/\D/g, '');
//               return {
//                 updateOne: {
//                   filter: { 
//                     recipientPhoneNumber: cleanPhone, 
//                     userId,
//                     'campaigns.campaignId': { $ne: campaignId } // Only update if campaignId doesn't exist
//                   },
//                   update: {
//                     $setOnInsert: { recipientPhoneNumber: cleanPhone, userId },
//                     $push: {
//                       campaigns: {
//                         campaignId,
//                         templateId,
//                         messageId: uuidv4(),
//                         status: 'pending',
//                         queuedAt: new Date(),
//                         userClickCount: 0,
//                         userReplyCount: 0
//                       }
//                     },
//                     $addToSet: { campaignIds: campaignId }
//                   },
//                   upsert: true
//                 }
//               };
//             });

//             await ContactCampaignMessage.bulkWrite(bulkOps, {
//               ordered: false,
//               writeConcern: { w: 0 }
//             });

//             totalProcessed += phoneNumbers.length;
//             const duration = Date.now() - startTime;
//             console.log(`[BatchConsumer] ✅ Chunk ${chunkIndex + 1}/${totalChunks} completed: ${phoneNumbers.length} contacts in ${duration}ms | Total: ${totalProcessed}`);

//             return { offset: message.offset, campaignId, totalChunks, chunkIndex };
//           } catch (error) {
//             console.error('[BatchConsumer] ❌ Processing error:', error.message);
//             return null;
//           }
//         });

//         const results = await Promise.all(processPromises);

//         for (const result of results) {
//           if (result) {
//             const { offset, campaignId, totalChunks, chunkIndex } = result;

//             const campaignKey = campaignId.toString();
//             if (!campaignChunks.has(campaignKey)) {
//               campaignChunks.set(campaignKey, { total: totalChunks, completed: new Set() });
//             }
//             campaignChunks.get(campaignKey).completed.add(chunkIndex);

//             await resolveOffset(offset);
//           }
//         }

//         for (const [campaignKey, progress] of campaignChunks.entries()) {
//           if (progress.completed.size === progress.total) {
//             const Campaign = (await import('../models/campaign.model.js')).default;
//             await Campaign.findByIdAndUpdate(campaignKey, { status: 'pending' });
//             console.log(`[BatchConsumer] ✅ Campaign ${campaignKey}: ALL ${progress.total} chunks completed - STATUS UPDATED`);
//             campaignChunks.delete(campaignKey);
//           }
//         }

//         await heartbeat();
//       }
//     });

//     const shutdown = async () => {
//       console.log('🛑 Shutting down batch entries consumer...');
//       await consumer.disconnect();
//       await mongoose.connection.close();
//       process.exit(0);
//     };

//     process.on('SIGTERM', shutdown);
//     process.on('SIGINT', shutdown);

//   } catch (error) {
//     console.error('❌ Batch entries consumer startup failed:', error);
//     process.exit(1);
//   }
// }

// startBatchEntriesConsumer();




import mongoose from 'mongoose';
import { Kafka } from 'kafkajs';
import connectDB from '../db/index.js';

process.env.WORKER_MODE = 'true';

const BULK_WRITE_SIZE = 500;            // SAFE & FAST
const MAX_PARTITION_CONCURRENCY = 1;    // IMPORTANT for MongoDB M10

async function startBatchEntriesConsumer() {
  try {
    /* -------------------- DB CONNECT -------------------- */
    await connectDB();
    console.log('✅ Batch Entries Consumer connected to MongoDB');

    /* -------------------- KAFKA SETUP -------------------- */
    const kafka = new Kafka({
      clientId: 'batch-entries-consumer',
      brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
      retry: { initialRetryTime: 100, retries: 8 }
    });

    const consumer = kafka.consumer({
      groupId: 'batch-entries-processor-production-v3',
      sessionTimeout: 600000,
      heartbeatInterval: 3000
    });

    await consumer.connect();
    await consumer.subscribe({ topic: 'campaign-batch-entries', fromBeginning: false });
    console.log('✅ Subscribed to campaign-batch-entries');

    /* -------------------- MODELS -------------------- */
    const ContactCampaignMessage = (await import('../models/contact_campaign_message.model.js')).default;
    const Campaign = (await import('../models/campaign.model.js')).default;
    const { v4: uuidv4 } = await import('uuid');

    /* -------------------- CONSUMER RUN -------------------- */
    await consumer.run({
      partitionsConsumedConcurrently: MAX_PARTITION_CONCURRENCY,
      eachBatchAutoResolve: false,

      eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning, isStale }) => {
        for (const message of batch.messages) {
          if (!isRunning() || isStale()) break;

          const batchStart = Date.now();

          try {
            const payload = JSON.parse(message.value.toString());
            const {
              campaignId,
              templateId,
              userId,
              phoneNumbers,
              totalChunks,
              chunkIndex
            } = payload;

            const campaignObjectId = new mongoose.Types.ObjectId(campaignId);

            console.log(
              `[BatchConsumer] Campaign ${campaignId} | Chunk ${chunkIndex + 1}/${totalChunks} | Contacts ${phoneNumbers.length}`
            );

            /* -------------------- BUILD BULK OPS -------------------- */
            const ops = [];

            for (const phone of phoneNumbers) {
              const cleanPhone = phone.replace(/^\+?91/, '').replace(/\D/g, '');

              ops.push({
                updateOne: {
                  filter: {
                    recipientPhoneNumber: cleanPhone,
                    userId,
                    'campaigns.campaignId': { $ne: campaignObjectId }
                  },
                  update: {
                    $setOnInsert: {
                      recipientPhoneNumber: cleanPhone,
                      userId
                    },
                    $push: {
                      campaigns: {
                        campaignId: campaignObjectId,
                        templateId,
                        messageId: uuidv4(),
                        status: 'pending',
                        queuedAt: new Date(),
                        userClickCount: 0,
                        userReplyCount: 0
                      }
                    },
                    $addToSet: { campaignIds: campaignObjectId }
                  },
                  upsert: true
                }
              });
            }

            /* -------------------- EXECUTE BULK WRITES -------------------- */
            for (let i = 0; i < ops.length; i += BULK_WRITE_SIZE) {
              await ContactCampaignMessage.bulkWrite(
                ops.slice(i, i + BULK_WRITE_SIZE),
                {
                  ordered: false,
                  writeConcern: { w: 1, j: false }
                }
              );
              await heartbeat();
            }

            /* -------------------- TRACK CHUNK COMPLETION -------------------- */
            await Campaign.findByIdAndUpdate(
              campaignObjectId,
              {
                $addToSet: { completedChunks: chunkIndex },
                $set: { totalChunks }
              }
            );

            /* -------------------- AUTO CAMPAIGN STATUS UPDATE -------------------- */
            // 🔥 Fast, single atomic DB check (runs only once)
            setImmediate(async () => {
              try {
                const updated = await Campaign.findOneAndUpdate(
                  {
                    _id: campaignObjectId,
                    status: 'draft',
                    $expr: { $eq: [{ $size: '$completedChunks' }, '$totalChunks'] }
                  },
                  {
                    status: 'pending',
                    completedAt: new Date(),
                    $unset: { completedChunks: '', totalChunks: '' }
                  }
                );

                if (updated) {
                  console.log(`🚀 Campaign ${campaignId} moved to PENDING`);
                }
              } catch (err) {
                console.error(`[CampaignStatusError] ${campaignId}`, err.message);
              }
            });

            /* -------------------- COMMIT OFFSET -------------------- */
            await resolveOffset(message.offset);
            await heartbeat();

            console.log(
              `[BatchConsumer] Done chunk ${chunkIndex + 1}/${totalChunks} in ${Date.now() - batchStart}ms`
            );

          } catch (err) {
            console.error('[BatchConsumer] Processing error:', err.message);
          }
        }
      }
    });

    /* -------------------- SHUTDOWN -------------------- */
    const shutdown = async () => {
      console.log('🛑 Shutting down batch entries consumer...');
      await consumer.disconnect();
      await mongoose.connection.close();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

  } catch (error) {
    console.error('❌ Batch consumer startup failed:', error);
    process.exit(1);
  }
}

startBatchEntriesConsumer();
