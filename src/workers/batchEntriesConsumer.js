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
    brokers: [process.env.KAFKA_BROKER || 'localhost:9092']
  });

  const consumer = kafka.consumer({
    groupId: 'batch-entries-processor-prod-final',
    sessionTimeout: 120000,
    heartbeatInterval: 10000,
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

        const start = Date.now();
        const data = JSON.parse(message.value.toString());

        const { campaignId, templateId, userId, phoneNumbers, chunkIndex, totalChunks, batchId } = data;
        const campaignObjectId = new mongoose.Types.ObjectId(campaignId);

        console.log(`[BatchConsumer] Campaign ${campaignId} | Chunk ${chunkIndex + 1}/${totalChunks} | ${phoneNumbers.length}`);

        // Generate unique batchId if not present (for old messages)
        const uniqueBatchId = batchId || `${campaignId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const docs = phoneNumbers.map((phone, index) => ({
          messageId: `${uniqueBatchId}-${chunkIndex}-${index}`,
          recipientPhoneNumber: phone.replace(/^\+?91/, '').replace(/\D/g, ''),
          userId,
          campaignId: campaignObjectId,
          templateId,
          status: 'pending',
          queuedAt: new Date(),
          userClickCount: 0,
          userReplyCount: 0
        }));

        // Insert with acknowledgment to ensure writes succeed
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

        // Track chunk completion (fire-and-forget)
        Campaign.findOneAndUpdate(
          { _id: campaignObjectId, status: 'draft' },
          { $addToSet: { completedChunks: chunkIndex }, $set: { totalChunks } }
        ).exec();

        // Update to pending if last chunk (fire-and-forget)
        if (chunkIndex === totalChunks - 1) {
          setTimeout(() => {
            Campaign.updateOne(
              { _id: campaignObjectId },
              { status: 'pending', $unset: { completedChunks: '', totalChunks: '' } }
            ).exec();
          }, 300);
          console.log(`[BatchConsumer] 🎯 Campaign ${campaignId} → pending`);
        }

        await resolveOffset(message.offset);
        await heartbeat();

        console.log(`[BatchConsumer] ✅ Chunk ${chunkIndex + 1}/${totalChunks} in ${Date.now() - start}ms`);
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
