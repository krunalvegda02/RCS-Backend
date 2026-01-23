import mongoose from 'mongoose';
import { Kafka } from 'kafkajs';
import connectDB from '../db/index.js';

process.env.WORKER_MODE = 'true';

async function startStatsConsumer() {
  try {
    await connectDB();
    console.log('✅ Stats Consumer connected to MongoDB');

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
      sessionTimeout: 30000,
      heartbeatInterval: 3000
    });

    await consumer.connect();
    await consumer.subscribe({ topic: 'message-stats', fromBeginning: true });
    console.log('✅ Stats Consumer subscribed to message-stats');

    const MessageLog = (await import('../models/messageLog.model.js')).default;
    const ContactCampaignMessage = (await import('../models/contact_campaign_message.model.js')).default;

    let totalProcessed = 0;

    // NOTE: Proactive polling for stuck campaigns has been REMOVED
    // Wallet settlement now happens via expirePendingMessages.js cron job

    await consumer.run({
      partitionsConsumedConcurrently: 4,
      eachBatchAutoResolve: false,
      eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning, isStale }) => {
        const startTime = Date.now();
        // 🔥 FIX #1 & #2: Process ALL messages in batch, ACK only on success
        const messages = batch.messages;
        const logIds = messages.map(m => JSON.parse(m.value.toString()).logId);

        console.log(`[StatsConsumer] Processing batch of ${logIds.length} log IDs`);

        const logs = await MessageLog.find({
          _id: { $in: logIds },
          processed: false
        }).lean();

        console.log(`[StatsConsumer] Found ${logs.length} unprocessed logs in DB`);

        if (logs.length === 0) {
          console.log('[StatsConsumer] No unprocessed logs, ACKing batch');
          if (messages.length > 0) {
            await resolveOffset(messages[messages.length - 1].offset);
          }
          await heartbeat();
          return;
        }

        const bulkOps = [];

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
            updateFields['campaigns.$.lastInteractionAt'] = timestamp;
            if (webhookData.suggestionResponse) {
              updateFields['campaigns.$.suggestionResponse'] = webhookData.suggestionResponse;
              updateFields['campaigns.$.clickedAt'] = timestamp;
              updateFields['campaigns.$.clickedAction'] = webhookData.suggestionResponse.plainText;
            }
            if (webhookData.rawPayload?.entity?.text) {
              updateFields['campaigns.$.userText'] = webhookData.rawPayload.entity.text;
            }
          } else {
            switch (eventType) {
              case 'MESSAGE_SENT':
              case 'SEND_MESSAGE_SUCCESS':
                newStatus = 'sent';
                updateFields['campaigns.$.sentAt'] = timestamp;
                break;

              case 'MESSAGE_DELIVERED':
                newStatus = 'delivered';
                updateFields['campaigns.$.deliveredAt'] = timestamp;
                break;

              case 'MESSAGE_READ':
                newStatus = 'read';
                updateFields['campaigns.$.readAt'] = timestamp;
                break;

              case 'SEND_MESSAGE_FAILURE':
              case 'MESSAGE_EXPIRED':
              case 'MESSAGE_REVOKED':
                newStatus = 'failed';
                updateFields['campaigns.$.failedAt'] = timestamp;
                updateFields['campaigns.$.errorCode'] = webhookData.rawPayload?.entity?.error?.code || 'UNKNOWN';
                updateFields['campaigns.$.errorMessage'] = webhookData.rawPayload?.entity?.error?.message || 'Failed';
                break;
            }
          }

          if (newStatus) {
            bulkOps.push({
              updateOne: {
                filter: {
                  'campaigns.messageId': messageId
                },
                update: {
                  $set: {
                    'campaigns.$.status': newStatus,
                    'campaigns.$.lastWebhookAt': timestamp,
                    ...updateFields
                  },
                  $inc: {
                    ...(webhookData.suggestionResponse && { 'campaigns.$.userClickCount': 1 }),
                    ...(webhookData.rawPayload?.entity?.text && { 'campaigns.$.userReplyCount': 1 })
                  }
                }
              }
            });
          }
        }

        // Bulk update messages
        let messageUpdateSuccess = false;
        if (bulkOps.length > 0) {
          try {
            const result = await ContactCampaignMessage.bulkWrite(bulkOps, { ordered: false });
            totalProcessed += result.modifiedCount;
            messageUpdateSuccess = true;
            console.log(`[StatsConsumer] ✅ Updated ${result.modifiedCount} messages | Total: ${totalProcessed}`);
          } catch (error) {
            console.error('[StatsConsumer] Bulk write error:', error.message);
          }
        } else {
          console.log('[StatsConsumer] No message updates needed');
          messageUpdateSuccess = true; // No updates needed is success
        }


        // if (messageUpdateSuccess && walletOps.size > 0) {
        //   const walletBulk = [];
        //   for (const [userIdStr, ops] of walletOps.entries()) {
        //     walletBulk.push({
        //       updateOne: {
        //         filter: { _id: userIdStr },
        //         update: {
        //           $inc: {
        //             'wallet.blockedBalance': -(ops.delivered + ops.refund),
        //             'wallet.balance': ops.refund
        //           },
        //           $set: { 'wallet.lastUpdated': new Date() }
        //         }
        //       }
        //     });
        //   }
        //   try {
        //     await User.bulkWrite(walletBulk, { ordered: false });
        //     console.log(`[StatsConsumer] ✅ Updated ${walletOps.size} wallets`);
        //   } catch (error) {
        //     console.error('[StatsConsumer] Wallet error:', error.message);
        //   }
        // }

        // 🔥 FIX #1: Mark as processed ONLY AFTER successful updates
        let allSuccess = false;

        if (messageUpdateSuccess) {
          try {
            const markResult = await MessageLog.updateMany(
              { _id: { $in: logs.map(l => l._id) }, processed: false },
              { $set: { processed: true, processedAt: new Date() } }
            );
            console.log(`[StatsConsumer] Marked ${markResult.modifiedCount} logs as processed`);
            allSuccess = true;
          } catch (error) {
            console.error('[StatsConsumer] ❌ Mark processed failed:', error.message);
          }
        }

        const duration = Date.now() - startTime;
        console.log(`[StatsConsumer] Batch complete: ${logs.length} logs in ${duration}ms`);

        // AUTO-SYNC CAMPAIGN STATS - Efficient batch sync
        if (allSuccess && bulkOps.length > 0) {
          const Campaign = (await import('../models/campaign.model.js')).default;
          
          // Extract campaignIds from updated documents
          const updatedDocs = await ContactCampaignMessage.find(
            { 'campaigns.messageId': { $in: logs.map(l => l.messageId) } },
            { 'campaigns.campaignId': 1 }
          ).lean();
          
          const affectedCampaigns = new Set();
          updatedDocs.forEach(doc => {
            doc.campaigns?.forEach(c => {
              if (c.campaignId) affectedCampaigns.add(c.campaignId.toString());
            });
          });
          
          if (affectedCampaigns.size > 0) {
            console.log(`[StatsConsumer] Auto-syncing stats for ${affectedCampaigns.size} campaigns`);
            
            await Promise.all(
              Array.from(affectedCampaigns).map(async (campaignId) => {
                try {
                  const campaign = await Campaign.findById(campaignId);
                  if (!campaign || campaign.status === 'settled') return;
                  
                  const aggregatedStats = await ContactCampaignMessage.aggregate([
                    { $match: { 'campaigns.campaignId': new mongoose.Types.ObjectId(campaignId) } },
                    { $unwind: '$campaigns' },
                    { $match: { 'campaigns.campaignId': new mongoose.Types.ObjectId(campaignId) } },
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
                  
                  await Campaign.findByIdAndUpdate(campaignId, {
                    'stats.total': stats.total,
                    'stats.pending': stats.pending,
                    'stats.sent': stats.sent,
                    'stats.delivered': stats.delivered,
                    'stats.read': stats.read,
                    'stats.replied': stats.replied,
                    'stats.failed': stats.failed,
                    'stats.bounced': 0
                  });
                  
                  console.log(`[StatsConsumer] ✅ Synced campaign ${campaignId}: total=${stats.total}, delivered=${stats.delivered}, failed=${stats.failed}`);
                } catch (err) {
                  console.error(`[StatsConsumer] Failed to sync campaign ${campaignId}:`, err.message);
                }
              })
            );
          }
        }

        // Campaign completion/wallet settlement now handled by expirePendingMessages.js script
        // No real-time wallet adjustments - only status tracking here

        // 🔥 FIX #1: ACK only if everything succeeded
        if (allSuccess && messages.length > 0) {
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
