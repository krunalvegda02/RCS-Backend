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
import { v4 as uuidv4 } from 'uuid';

process.env.WORKER_MODE = 'true';

const BULK_SIZE = 1000;

async function startBatchEntriesConsumer() {
  await connectDB();
  console.log('✅ MongoDB connected');

  const kafka = new Kafka({
    clientId: 'batch-entries-consumer',
    brokers: [process.env.KAFKA_BROKER || 'localhost:9092']
  });

  const consumer = kafka.consumer({
    groupId: 'batch-entries-processor-prod-final',
    sessionTimeout: 600000,
    heartbeatInterval: 3000
  });

  await consumer.connect();
  await consumer.subscribe({ topic: 'campaign-batch-entries', fromBeginning: false });

  console.log('✅ Subscribed to campaign-batch-entries');

  const ContactCampaignMessage = (await import('../models/contact_campaign_message.model.js')).default;
  const Campaign = (await import('../models/campaign.model.js')).default;

  await consumer.run({
    partitionsConsumedConcurrently: 1,
    eachBatchAutoResolve: false,

    eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning, isStale }) => {
      for (const message of batch.messages) {
        if (!isRunning() || isStale()) break;

        await heartbeat(); // 🔥 PREVENT REBALANCE

        const start = Date.now();
        const data = JSON.parse(message.value.toString());

        const {
          campaignId,
          templateId,
          userId,
          phoneNumbers,
          chunkIndex,
          totalChunks
        } = data;

        const campaignObjectId = new mongoose.Types.ObjectId(campaignId);

        console.log(
          `[BatchConsumer] Campaign ${campaignId} | Chunk ${chunkIndex + 1}/${totalChunks} | ${phoneNumbers.length}`
        );

        const ops = phoneNumbers.map(phone => {
          const cleanPhone = phone.replace(/^\+?91/, '').replace(/\D/g, '');

          return {
            updateOne: {
              filter: { recipientPhoneNumber: cleanPhone, userId },
              update: {
                $setOnInsert: {
                  recipientPhoneNumber: cleanPhone,
                  userId
                },
                $addToSet: {
                  campaignIds: campaignObjectId,
                  campaigns: {
                    campaignId: campaignObjectId,
                    templateId,
                    messageId: uuidv4(),
                    status: 'pending',
                    queuedAt: new Date(),
                    userClickCount: 0,
                    userReplyCount: 0
                  }
                }
              },
              upsert: true
            }
          };
        });

        // Execute in mini-batches
        for (let i = 0; i < ops.length; i += BULK_SIZE) {
          await ContactCampaignMessage.bulkWrite(
            ops.slice(i, i + BULK_SIZE),
            { ordered: false, writeConcern: { w: 1 } }
          );
          await heartbeat(); // 🔥 KEEP SESSION ALIVE
        }

        // Track chunk completion
        await Campaign.findByIdAndUpdate(
          campaignObjectId,
          {
            $addToSet: { completedChunks: chunkIndex },
            $set: { totalChunks }
          }
        );

        // Update campaign status ONCE
        setImmediate(async () => {
          await Campaign.findOneAndUpdate(
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
        });

        await resolveOffset(message.offset);
        await heartbeat();

        console.log(
          `[BatchConsumer] Finished chunk ${chunkIndex + 1}/${totalChunks} in ${Date.now() - start}ms`
        );
      }
    }
  });

  const shutdown = async () => {
    console.log('🛑 Shutting down consumer');
    await consumer.disconnect();
    await mongoose.connection.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startBatchEntriesConsumer();
