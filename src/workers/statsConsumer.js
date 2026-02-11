import mongoose from 'mongoose';
import { Kafka } from 'kafkajs';
import connectDB from '../db/index.js';

process.env.WORKER_MODE = 'true';

async function startStatsConsumer() {
  try {
    await connectDB();

    const kafka = new Kafka({
      clientId: 'stats-consumer',
      brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
      retry: {
        initialRetryTime: 100,
        retries: 8
      }
    });

    const consumer = kafka.consumer({
      groupId: `stats-processor-${process.env.NODE_ENV || 'dev'}`,
      sessionTimeout: 120000, // 2 minutes
      heartbeatInterval: 5000, // 5 seconds
      rebalanceTimeout: 120000, // 2 minutes
      maxWaitTimeInMs: 5000,
      retry: {
        retries: 5,
        initialRetryTime: 300
      }
    });

    await consumer.connect();
    await consumer.subscribe({ topic: 'message-stats', fromBeginning: false });

    console.log('✅ Stats Consumer subscribed to message-stats');
    console.log(`[StatsConsumer] Consumer group: stats-processor-${process.env.NODE_ENV || 'dev'}`);
    console.log(`[StatsConsumer] Kafka broker: ${process.env.KAFKA_BROKER || 'localhost:9092'}`);

    const MessageLog = (await import('../models/messageLog.model.js')).default;
    const ContactCampaignMessage = (await import('../models/contactMessage.model.js')).default;
    const Campaign = (await import('../models/campaign.model.js')).default;

    let totalProcessed = 0;
    let batchCount = 0;

    await consumer.run({
      partitionsConsumedConcurrently: 1,
      eachBatchAutoResolve: false,

      eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning, isStale }) => {
        batchCount++;
        const startTime = Date.now();
        const messages = batch.messages;
        
        console.log(`[StatsConsumer] Batch #${batchCount}: Received ${messages.length} messages from partition ${batch.partition}`);
        
        if (messages.length === 0) {
          await heartbeat();
          return;
        }

        // Extract log IDs from Kafka messages
        const logIds = [];
        for (const message of messages) {
          try {
            const payload = JSON.parse(message.value.toString());
            if (payload.logId) logIds.push(payload.logId);
          } catch (err) {
            console.error('[StatsConsumer] Parse error:', err.message);
          }
        }

        if (logIds.length === 0) {
          console.log(`[StatsConsumer] Batch #${batchCount}: No valid log IDs found in messages`);
          await resolveOffset(messages[messages.length - 1].offset);
          await heartbeat();
          return;
        }

        console.log(`[StatsConsumer] Batch #${batchCount}: Processing ${logIds.length} log IDs`);

        // Fetch unprocessed logs from DB
        const logs = await MessageLog.find({
          _id: { $in: logIds },
          processed: false
        }).lean();

        if (logs.length === 0) {
          console.log(`[StatsConsumer] Batch #${batchCount}: No unprocessed logs found (all already processed)`);
          await resolveOffset(messages[messages.length - 1].offset);
          await heartbeat();
          return;
        }

        console.log(`[StatsConsumer] Batch #${batchCount}: Found ${logs.length} unprocessed logs`);

        // Process in chunks to avoid timeout
        const CHUNK_SIZE = 500;
        const chunks = [];
        for (let i = 0; i < logs.length; i += CHUNK_SIZE) {
          chunks.push(logs.slice(i, i + CHUNK_SIZE));
        }

        console.log(`[StatsConsumer] Batch #${batchCount}: Processing ${chunks.length} chunks of ${CHUNK_SIZE}`);

        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
          const chunk = chunks[chunkIndex];
          const bulkOps = [];
          const affectedCampaigns = new Set();
          
          await heartbeat(); // Heartbeat before each chunk



          for (const log of chunk) {
          const { messageId, webhookData, eventType: logEventType } = log;
          const eventType = webhookData?.eventType;
          const entity = webhookData?.rawPayload?.entity;
          const entityType = webhookData?.rawPayload?.entityType;

          const webhookTimestamp = entity?.sendTime || entity?.deliveryTime ||
            entity?.readTime || entity?.receiveTime || log.timestamp;
          const timestamp = new Date(webhookTimestamp);

          let newStatus = null;
          let updateFields = {};

          const isUserInteraction = logEventType === 'user_interaction' || entityType === 'USER_MESSAGE';

          // Status priority: replied > read > delivered > sent > pending
          const statusPriority = {
            'pending': 1,
            'queued': 1,
            'sent': 2,
            'delivered': 3,
            'read': 4,
            'replied': 5,
            'failed': 6,
            'expired': 6
          };

          if (isUserInteraction) {
            newStatus = 'replied';
            updateFields.lastInteractionAt = timestamp;
            if (webhookData.suggestionResponse) {
              updateFields.suggestionResponse = webhookData.suggestionResponse;
              updateFields.clickedAt = timestamp;
              updateFields.clickedAction = webhookData.suggestionResponse.plainText;
            }
            if (webhookData.rawPayload?.entity?.text) {
              updateFields.userText = webhookData.rawPayload.entity.text;
            }
          } else {
            switch (eventType) {
              case 'MESSAGE_SENT':
              case 'SEND_MESSAGE_SUCCESS':
                newStatus = 'sent';
                updateFields.sentAt = timestamp;
                break;

              case 'MESSAGE_DELIVERED':
                newStatus = 'delivered';
                updateFields.deliveredAt = timestamp;
                break;

              case 'MESSAGE_READ':
                newStatus = 'read';
                updateFields.readAt = timestamp;
                break;

              case 'SEND_MESSAGE_FAILURE':
              case 'MESSAGE_EXPIRED':
              case 'MESSAGE_REVOKED':
                newStatus = 'failed';
                updateFields.failedAt = timestamp;
                updateFields.errorCode = webhookData.rawPayload?.entity?.error?.code || 'UNKNOWN';
                updateFields.errorMessage = webhookData.rawPayload?.entity?.error?.message || 'Failed';
                break;
            }
          }

          if (newStatus) {
            const currentPriority = statusPriority[newStatus] || 0;
            
            // Build list of statuses that can be upgraded from
            const upgradableStatuses = [];
            for (const [status, priority] of Object.entries(statusPriority)) {
              if (priority < currentPriority) {
                upgradableStatuses.push(status);
              }
            }
            
            bulkOps.push({
              updateOne: {
                filter: { 
                  messageId,
                  $or: [
                    { status: { $exists: false } },
                    { status: { $in: upgradableStatuses } }
                  ]
                },
                update: {
                  $set: {
                    status: newStatus,
                    lastWebhookAt: timestamp,
                    ...updateFields
                  },
                  $inc: {
                    ...(webhookData.suggestionResponse && { userClickCount: 1 }),
                    ...(webhookData.rawPayload?.entity?.text && { userReplyCount: 1 })
                  }
                },
                upsert: false
              }
            });
          }
          }

          // Bulk update ContactCampaignMessage for this chunk
          if (bulkOps.length > 0) {
            try {
              const result = await ContactCampaignMessage.bulkWrite(bulkOps, { ordered: false });
              totalProcessed += result.modifiedCount;
              console.log(`[StatsConsumer] Chunk ${chunkIndex + 1}/${chunks.length}: Updated ${result.modifiedCount} messages`);

              // Collect affected campaigns
              const updatedMessages = await ContactCampaignMessage.find(
                { messageId: { $in: chunk.map(l => l.messageId) } },
                { campaignId: 1 }
              ).lean();
              updatedMessages.forEach(msg => {
                if (msg.campaignId) affectedCampaigns.add(msg.campaignId.toString());
              });
            } catch (error) {
              console.error(`[StatsConsumer] Chunk ${chunkIndex + 1} bulk write error:`, error.message);
            }
          }

          await heartbeat(); // Heartbeat after bulk write

          // Mark chunk logs as processed
          try {
            await MessageLog.updateMany(
              { _id: { $in: chunk.map(l => l._id) } },
              { $set: { processed: true, processedAt: new Date() } }
            );
          } catch (error) {
            console.error(`[StatsConsumer] Chunk ${chunkIndex + 1} mark processed error:`, error.message);
          }

          await heartbeat(); // Heartbeat after marking processed

          // Sync campaign stats for this chunk
          if (affectedCampaigns.size > 0) {
            const campaignIds = Array.from(affectedCampaigns);
            for (const campaignId of campaignIds) {
              try {
                const campaign = await Campaign.findById(campaignId);
                if (campaign) {
                  await campaign.syncStats();
                }
              } catch (err) {
                console.error(`[StatsConsumer] Sync error for ${campaignId}:`, err.message);
              }
            }
          }

          await heartbeat(); // Heartbeat after campaign sync
        }



        const duration = Date.now() - startTime;
        console.log(`[StatsConsumer] Batch #${batchCount} complete in ${duration}ms | Total processed: ${totalProcessed}`);

        // ACK batch
        if (messages.length > 0) {
          await resolveOffset(messages[messages.length - 1].offset);
        }
        await heartbeat();
      }
    });

    // Log consumer status every 30 seconds
    setInterval(() => {
      console.log(`[StatsConsumer] Status: ${batchCount} batches processed | ${totalProcessed} messages updated`);
    }, 30000);






    const shutdown = async () => {
      console.log('🛑 Shutting down stats consumer...');
      await consumer.disconnect();
      await mongoose.connection.close();
      process.exit(0);
    };


    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);





  } catch (error) {
    console.error('❌ Stats consumer startup failed:', error);
    process.exit(1);
  }
}

startStatsConsumer();
