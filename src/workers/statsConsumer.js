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
      sessionTimeout: 60000, // 1 minute 
      heartbeatInterval: 3000, // 3 seconds (more frequent)
      rebalanceTimeout: 60000, // 1 minute
      maxWaitTimeInMs: 10000, // Wait max 5s for new messages
      retry: {
        retries: 5,
        initialRetryTime: 300
      }
    });

    await consumer.connect();
    await consumer.subscribe({ topic: 'message-stats', fromBeginning: false });

    console.log('✅ Stats Consumer subscribed to message-stats');

    const MessageLog = (await import('../models/messageLog.model.js')).default;
    const ContactCampaignMessage = (await import('../models/contactMessage.model.js')).default;
    const Campaign = (await import('../models/campaign.model.js')).default;


    let totalProcessed = 0;


    await consumer.run({
      partitionsConsumedConcurrently: 1,
      eachBatchAutoResolve: false,
      eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning, isStale }) => {
        const startTime = Date.now();
        const messages = batch.messages;
        
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
          await resolveOffset(messages[messages.length - 1].offset);
          await heartbeat();
          return;
        }

        console.log(`[StatsConsumer] Processing ${logIds.length} log IDs`);

        // Fetch unprocessed logs from DB
        const logs = await MessageLog.find({
          _id: { $in: logIds },
          processed: false
        }).lean();

        if (logs.length === 0) {
          console.log('[StatsConsumer] No unprocessed logs found');
          await resolveOffset(messages[messages.length - 1].offset);
          await heartbeat();
          return;
        }

        console.log(`[StatsConsumer] Found ${logs.length} unprocessed logs`);

        const bulkOps = [];
        const affectedCampaigns = new Set();



        for (const log of logs) {
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
            bulkOps.push({
              updateOne: {
                filter: { messageId },
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

        // Bulk update ContactCampaignMessage
        let updateSuccess = false;
        if (bulkOps.length > 0) {
          try {
            const result = await ContactCampaignMessage.bulkWrite(bulkOps, { ordered: false });
            totalProcessed += result.modifiedCount;
            updateSuccess = true;
            console.log(`[StatsConsumer] ✅ Updated ${result.modifiedCount} messages | Total: ${totalProcessed}`);

            // Collect affected campaigns
            const updatedMessages = await ContactCampaignMessage.find(
              { messageId: { $in: logs.map(l => l.messageId) } },
              { campaignId: 1 }
            ).lean();
            updatedMessages.forEach(msg => {
              if (msg.campaignId) affectedCampaigns.add(msg.campaignId.toString());
            });
          } catch (error) {
            console.error('[StatsConsumer] Bulk write error:', error.message);
          }
        } else {
          updateSuccess = true;
        }



        // Mark logs as processed
        if (updateSuccess) {
          try {
            await MessageLog.updateMany(
              { _id: { $in: logs.map(l => l._id) } },
              { $set: { processed: true, processedAt: new Date() } }
            );
            console.log(`[StatsConsumer] Marked ${logs.length} logs as processed`);
          } catch (error) {
            console.error('[StatsConsumer] Mark processed error:', error.message);
          }
        }



        // Sync campaign stats
        if (affectedCampaigns.size > 0) {
          console.log(`[StatsConsumer] Syncing ${affectedCampaigns.size} campaigns`);
          await Promise.all(
            Array.from(affectedCampaigns).map(async (campaignId) => {
              try {
                const campaign = await Campaign.findById(campaignId);
                if (campaign && campaign.status !== 'settled') {
                  await campaign.syncStats();
                }
              } catch (err) {
                console.error(`[StatsConsumer] Sync error for ${campaignId}:`, err.message);
              }
            })
          );
        }



        const duration = Date.now() - startTime;
        console.log(`[StatsConsumer] Batch complete in ${duration}ms`);



        // ACK batch
        if (messages.length > 0) {
          await resolveOffset(messages[messages.length - 1].offset);
        }
        await heartbeat();
      }
    });






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
