import mongoose from 'mongoose';
import { Kafka } from 'kafkajs';
import connectDB from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';

process.env.WORKER_MODE = 'true';

const BULK_SIZE = 2000; // Increased from 1000

async function startBatchEntriesConsumer() {
  await connectDB();
  console.log('✅ MongoDB connected');

  const kafka = new Kafka({
    clientId: 'batch-entries-consumer',
    brokers: [process.env.KAFKA_BROKER || 'localhost:9092']
  });

  const consumer = kafka.consumer({
    groupId: 'batch-entries-processor-prod-final',
    sessionTimeout: 1200000,     
    heartbeatInterval: 5000,   
  });

  await consumer.connect();
  await consumer.subscribe({ topic: 'campaign-batch-entries', fromBeginning: false });

  console.log('✅ Subscribed to campaign-batch-entries');

  const ContactCampaignMessage = (await import('../models/contactMessage.model.js')).default;
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

        const docs = phoneNumbers.map(phone => {
          const cleanPhone = phone.replace(/^\+?91/, '').replace(/\D/g, '');
          const messageId = uuidv4();

          return {
            messageId,
            recipientPhoneNumber: cleanPhone,
            userId,
            campaignId: campaignObjectId,
            templateId,
            status: 'pending',
            queuedAt: new Date(),
            userClickCount: 0,
            userReplyCount: 0
          };
        });

        // Insert in mini-batches with unacknowledged writes
        for (let i = 0; i < docs.length; i += BULK_SIZE) {
          await ContactCampaignMessage.insertMany(
            docs.slice(i, i + BULK_SIZE),
            { ordered: false, writeConcern: { w: 0 } } // Fire and forget
          );
          await heartbeat();
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
