import mongoose from 'mongoose';
import { Kafka } from 'kafkajs';
import connectDB from '../db/index.js';
import campaignStatsWorker from './campaignStatsWorker.js';

process.env.WORKER_MODE = 'true';

// Direct database processing function with improved coordination
async function processUnprocessedLogsDirectly() {
  try {
    const MessageLog = (await import('../models/messageLog.model.js')).default;
    const ContactCampaignMessage = (await import('../models/contactMessage.model.js')).default;

    // 🔒 INSTANCE COORDINATION: Only one instance should do initial count
    const instanceId = `direct-${process.pid}-${Date.now()}`;
    console.log(`🚀 Instance ${instanceId} starting direct processing...`);
    
    // Small random delay to prevent all instances from starting simultaneously
    await new Promise(resolve => setTimeout(resolve, Math.random() * 5000));

    const count = await MessageLog.countDocuments({ 
      processed: false,
      processingLock: { $exists: false } // Only count unlocked logs
    });
    
    console.log(`📊 Instance ${instanceId}: Found ${count} unprocessed unlocked logs`);

    if (count === 0) {
      console.log(`✅ Instance ${instanceId}: No unprocessed logs found`);
      return;
    }

    console.log(`🚀 Instance ${instanceId}: Processing unprocessed logs directly from database...`);
    
    const BATCH_SIZE = 1000; // Reduced for better coordination
    let processed = 0;
    let consecutiveEmptyBatches = 0;
    const MAX_EMPTY_BATCHES = 3;

    while (consecutiveEmptyBatches < MAX_EMPTY_BATCHES) {
      // 🔒 ATOMIC FETCH AND LOCK with better query
      const lockResult = await MessageLog.updateMany(
        { 
          processed: false,
          processingLock: { $exists: false }
        },
        { 
          $set: { 
            processingLock: instanceId,
            processingStartedAt: new Date()
          }
        },
        { limit: BATCH_SIZE }
      );

      if (lockResult.modifiedCount === 0) {
        consecutiveEmptyBatches++;
        console.log(`🔒 Instance ${instanceId}: No more unlocked logs available (attempt ${consecutiveEmptyBatches}/${MAX_EMPTY_BATCHES})`);
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait before retry
        continue;
      }

      consecutiveEmptyBatches = 0; // Reset counter
      console.log(`🔒 Instance ${instanceId}: Locked ${lockResult.modifiedCount} logs`);

      // Fetch the logs we just locked
      const logs = await MessageLog.find({ 
        processingLock: instanceId,
        processed: false
      })
      .limit(BATCH_SIZE)
      .lean();

      if (logs.length === 0) {
        console.log(`⚠️ Instance ${instanceId}: No logs found after locking`);
        continue;
      }

      console.log(`📝 Instance ${instanceId}: Processing batch of ${logs.length} logs (Total processed: ${processed})`);

      // 🔄 PRESERVED: Process logs using same logic as Kafka consumer
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

        // 🔄 PRESERVED: Original status priority system
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

      // 🔄 PRESERVED: Bulk update ContactCampaignMessage
      if (bulkOps.length > 0) {
        try {
          const result = await ContactCampaignMessage.bulkWrite(bulkOps, { 
            ordered: false,
            writeConcern: { w: 1, j: false } // ⚡ Fast write
          });
          console.log(`✅ Updated ${result.modifiedCount} messages`);
        } catch (error) {
          console.error(`❌ Bulk write error:`, error.message);
        }
      }

      // 🚀 FAST MARK AS PROCESSED WITH LOCK REMOVAL
      try {
        await MessageLog.updateMany(
          { 
            _id: { $in: logs.map(l => l._id) },
            processingLock: instanceId // 🔒 Only update logs we locked
          },
          { 
            $set: { processed: true, processedAt: new Date() },
            $unset: { processingLock: 1, processingStartedAt: 1 } // 🔓 Remove lock
          },
          { writeConcern: { w: 1, j: false } }
        );
        processed += logs.length;
      } catch (error) {
        console.error(`❌ Mark processed error:`, error.message);
        // 🔒 CLEANUP: Remove locks on error
        await MessageLog.updateMany(
          { _id: { $in: logs.map(l => l._id) }, processingLock: instanceId },
          { $unset: { processingLock: 1, processingStartedAt: 1 } }
        );
      }

      skip += logs.length; // 🔄 Use actual processed count
      console.log(`📈 Progress: ${processed}/${count} (${Math.round((processed/count)*100)}%)`);

      // ⚡ NO DELAY - Maximum speed
    }

    console.log(`🎉 Direct processing complete: ${processed} logs processed`);
  } catch (error) {
    console.error('❌ Direct processing error:', error);
  }
}

async function startStatsConsumer() {
  try {
    await connectDB();
    await campaignStatsWorker.start();

    // 🚀 TEMPORARILY SKIP DIRECT PROCESSING - Let Kafka consumers work
    console.log('⚡ Skipping direct processing - starting Kafka consumer immediately...');
    // await processUnprocessedLogsDirectly();

    const kafka = new Kafka({
      clientId: 'stats-consumer',
      brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
      retry: {
        initialRetryTime: 100,
        retries: 8
      }
    });

    const consumer = kafka.consumer({
      groupId: `stats-processor-shared`, // 🚀 Shared group for load balancing
      sessionTimeout: 300000,
      heartbeatInterval: 3000,
      rebalanceTimeout: 300000,
      maxWaitTimeInMs: 1000, // ⚡ Faster message fetching
      fetchMaxBytes: 10485760, // 🚀 10MB fetch size
      fetchMaxWaitMs: 500, // ⚡ Faster fetch
      retry: {
        retries: 5,
        initialRetryTime: 300
      }
    });

    await consumer.connect();
    await consumer.subscribe({ topic: 'message-stats', fromBeginning: false });

    console.log('✅ Stats Consumer subscribed to message-stats');
    console.log(`[StatsConsumer] Consumer group: stats-processor-shared`);
    console.log(`[StatsConsumer] Kafka broker: ${process.env.KAFKA_BROKER || 'localhost:9092'}`);

    const MessageLog = (await import('../models/messageLog.model.js')).default;
    const ContactCampaignMessage = (await import('../models/contactMessage.model.js')).default;
    const Campaign = (await import('../models/campaign.model.js')).default;

    let totalProcessed = 0;
    let batchCount = 0;

    await consumer.run({
      partitionsConsumedConcurrently: 10, // 🚀 Double parallelism
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

        // Fetch unprocessed logs from DB (SIMPLIFIED APPROACH)
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

        console.log(`[StatsConsumer] Batch #${batchCount}: Found ${logs.length} unprocessed logs to process`);

        // Process in chunks to avoid timeout
        const CHUNK_SIZE = 1000; // ⚡ Reduced for faster processing
        const chunks = [];
        for (let i = 0; i < logs.length; i += CHUNK_SIZE) {
          chunks.push(logs.slice(i, i + CHUNK_SIZE));
        }

        console.log(`[StatsConsumer] Batch #${batchCount}: Processing ${chunks.length} chunks of ${CHUNK_SIZE}`);

        // 🚀 SEQUENTIAL CHUNK PROCESSING (FASTER & MORE STABLE)
        let totalUpdated = 0;
        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
          const chunk = chunks[chunkIndex];
          const bulkOps = [];
          const statusChanges = new Map(); // 🔄 PRESERVED: Original status tracking
          
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

            // 🔄 PRESERVED: Original status priority system
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
              
              // 🔄 PRESERVED: Original upgradable status logic
              const upgradableStatuses = [];
              for (const [status, priority] of Object.entries(statusPriority)) {
                if (priority < currentPriority) {
                  upgradableStatuses.push(status);
                }
              }
              
              // 🔄 PRESERVED: Store for incremental update
              statusChanges.set(messageId, newStatus);
              
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

          // 🔄 PRESERVED: Get OLD status BEFORE bulk update for accurate incremental stats
          const messageIds = Array.from(statusChanges.keys());
          const oldStatusMap = new Map();
          
          if (messageIds.length > 0) {
            const existingMessages = await ContactCampaignMessage.find(
              { messageId: { $in: messageIds } },
              { messageId: 1, status: 1, campaignId: 1 }
            ).lean();
            
            for (const msg of existingMessages) {
              oldStatusMap.set(msg.messageId, {
                oldStatus: msg.status || 'pending',
                campaignId: msg.campaignId
              });
            }
          }

          // 🚀 BULK UPDATE WITH HIGH PERFORMANCE (PRESERVED LOGIC)
          if (bulkOps.length > 0) {
            try {
              console.log(`[StatsConsumer] Chunk ${chunkIndex + 1}: Attempting ${bulkOps.length} updates. Sample messageIds: ${Array.from(statusChanges.keys()).slice(0, 3).join(', ')}`);
              
              const result = await ContactCampaignMessage.bulkWrite(bulkOps, { 
                ordered: false,
                writeConcern: { w: 1, j: false } // ⚡ Fast write concern
              });
              console.log(`[StatsConsumer] Chunk ${chunkIndex + 1}: Updated ${result.modifiedCount}/${bulkOps.length} messages (matched: ${result.matchedCount})`);
              totalUpdated += result.modifiedCount;

              // 🔄 PRESERVED: MINIMAL CPU logging
              if (result.modifiedCount > 0) {
                console.log(`[StatsConsumer] ${result.modifiedCount} messages updated - stats will sync periodically`);
              } else if (result.matchedCount === 0) {
                console.log(`[StatsConsumer] ⚠️ No messages matched - messageIds not found in ContactCampaignMessage`);
              } else {
                console.log(`[StatsConsumer] ⚠️ ${result.matchedCount} matched but 0 modified - status priority conditions not met`);
              }
            } catch (error) {
              console.error(`[StatsConsumer] Chunk ${chunkIndex + 1} bulk write error:`, error.message);
            }
          }
          
          await heartbeat(); // Heartbeat after each chunk
        }

        totalProcessed += totalUpdated;

        // 🚀 BULK MARK AS PROCESSED (SIMPLIFIED)
        const allLogIds = logs.map(l => l._id);
        try {
          await MessageLog.updateMany(
            { _id: { $in: allLogIds } },
            { $set: { processed: true, processedAt: new Date() } },
            { writeConcern: { w: 1, j: false } }
          );
          console.log(`[StatsConsumer] Batch #${batchCount}: Marked ${allLogIds.length} logs as processed`);
        } catch (error) {
          console.error(`[StatsConsumer] Mark processed error:`, error.message);
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















// import mongoose from 'mongoose';
// import { Kafka } from 'kafkajs';
// import connectDB from '../db/index.js';
// import campaignStatsWorker from './campaignStatsWorker.js';

// process.env.WORKER_MODE = 'true';

// async function startStatsConsumer() {
//   try {
//     await connectDB();
//     await campaignStatsWorker.start();

//     const kafka = new Kafka({
//       clientId: 'stats-consumer',
//       brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
//       retry: {
//         initialRetryTime: 100,
//         retries: 8
//       }
//     });

//     const consumer = kafka.consumer({
//       groupId: `stats-processor-${process.env.NODE_ENV || 'dev'}`,
//       sessionTimeout: 300000, // 5 minutes (increased from 2 minutes)
//       heartbeatInterval: 3000, // 3 seconds (reduced from 5 seconds)
//       rebalanceTimeout: 300000, // 5 minutes (increased from 2 minutes)
//       maxWaitTimeInMs: 3000, // Reduced from 5 seconds
//       retry: {
//         retries: 5,
//         initialRetryTime: 300
//       }
//     });

//     await consumer.connect();
//     await consumer.subscribe({ topic: 'message-stats', fromBeginning: false });

//     console.log('✅ Stats Consumer subscribed to message-stats');
//     console.log(`[StatsConsumer] Consumer group: stats-processor-${process.env.NODE_ENV || 'dev'}`);
//     console.log(`[StatsConsumer] Kafka broker: ${process.env.KAFKA_BROKER || 'localhost:9092'}`);

//     const MessageLog = (await import('../models/messageLog.model.js')).default;
//     const ContactCampaignMessage = (await import('../models/contactMessage.model.js')).default;
//     const Campaign = (await import('../models/campaign.model.js')).default;

//     let totalProcessed = 0;
//     let batchCount = 0;

//     await consumer.run({
//       partitionsConsumedConcurrently: 1,
//       eachBatchAutoResolve: false,

//       eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning, isStale }) => {
//         batchCount++;
//         const startTime = Date.now();
//         const messages = batch.messages;
        
//         console.log(`[StatsConsumer] Batch #${batchCount}: Received ${messages.length} messages from partition ${batch.partition}`);
        
//         if (messages.length === 0) {
//           await heartbeat();
//           return;
//         }

//         // Extract log IDs from Kafka messages
//         const logIds = [];
//         for (const message of messages) {
//           try {
//             const payload = JSON.parse(message.value.toString());
//             if (payload.logId) logIds.push(payload.logId);
//           } catch (err) {
//             console.error('[StatsConsumer] Parse error:', err.message);
//           }
//         }

//         if (logIds.length === 0) {
//           console.log(`[StatsConsumer] Batch #${batchCount}: No valid log IDs found in messages`);
//           await resolveOffset(messages[messages.length - 1].offset);
//           await heartbeat();
//           return;
//         }

//         console.log(`[StatsConsumer] Batch #${batchCount}: Processing ${logIds.length} log IDs`);

//         // Fetch unprocessed logs from DB
//         const logs = await MessageLog.find({
//           _id: { $in: logIds },
//           processed: false
//         }).lean();

//         if (logs.length === 0) {
//           console.log(`[StatsConsumer] Batch #${batchCount}: No unprocessed logs found (all already processed)`);
//           await resolveOffset(messages[messages.length - 1].offset);
//           await heartbeat();
//           return;
//         }

//         console.log(`[StatsConsumer] Batch #${batchCount}: Found ${logs.length} unprocessed logs`);

//         // Process in chunks to avoid timeout
//         const CHUNK_SIZE = 1000; // Increased from 500
//         const chunks = [];
//         for (let i = 0; i < logs.length; i += CHUNK_SIZE) {
//           chunks.push(logs.slice(i, i + CHUNK_SIZE));
//         }

//         console.log(`[StatsConsumer] Batch #${batchCount}: Processing ${chunks.length} chunks of ${CHUNK_SIZE}`);

//         for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
//           const chunk = chunks[chunkIndex];
//           const bulkOps = [];
//           const statusChanges = new Map();
          
//           await heartbeat(); // Heartbeat before each chunk

//           for (const log of chunk) {
//             const { messageId, webhookData, eventType: logEventType } = log;
//             const eventType = webhookData?.eventType;
//             const entity = webhookData?.rawPayload?.entity;
//             const entityType = webhookData?.rawPayload?.entityType;

//             const webhookTimestamp = entity?.sendTime || entity?.deliveryTime ||
//               entity?.readTime || entity?.receiveTime || log.timestamp;
//             const timestamp = new Date(webhookTimestamp);

//             let newStatus = null;
//             let updateFields = {};

//             const isUserInteraction = logEventType === 'user_interaction' || entityType === 'USER_MESSAGE';

//             // Status priority: replied > read > delivered > sent > pending
//             const statusPriority = {
//               'pending': 1,
//               'queued': 1,
//               'sent': 2,
//               'delivered': 3,
//               'read': 4,
//               'replied': 5,
//               'failed': 6,
//               'expired': 6
//             };

//             if (isUserInteraction) {
//               newStatus = 'replied';
//               updateFields.lastInteractionAt = timestamp;
//               if (webhookData.suggestionResponse) {
//                 updateFields.suggestionResponse = webhookData.suggestionResponse;
//                 updateFields.clickedAt = timestamp;
//                 updateFields.clickedAction = webhookData.suggestionResponse.plainText;
//               }
//               if (webhookData.rawPayload?.entity?.text) {
//                 updateFields.userText = webhookData.rawPayload.entity.text;
//               }
//             } else {
//               switch (eventType) {
//                 case 'MESSAGE_SENT':
//                 case 'SEND_MESSAGE_SUCCESS':
//                   newStatus = 'sent';
//                   updateFields.sentAt = timestamp;
//                   break;

//                 case 'MESSAGE_DELIVERED':
//                   newStatus = 'delivered';
//                   updateFields.deliveredAt = timestamp;
//                   break;

//                 case 'MESSAGE_READ':
//                   newStatus = 'read';
//                   updateFields.readAt = timestamp;
//                   break;

//                 case 'SEND_MESSAGE_FAILURE':
//                 case 'MESSAGE_EXPIRED':
//                 case 'MESSAGE_REVOKED':
//                   newStatus = 'failed';
//                   updateFields.failedAt = timestamp;
//                   updateFields.errorCode = webhookData.rawPayload?.entity?.error?.code || 'UNKNOWN';
//                   updateFields.errorMessage = webhookData.rawPayload?.entity?.error?.message || 'Failed';
//                   break;
//               }
//             }

//             if (newStatus) {
//               const currentPriority = statusPriority[newStatus] || 0;
              
//               // Build list of statuses that can be upgraded from
//               const upgradableStatuses = [];
//               for (const [status, priority] of Object.entries(statusPriority)) {
//                 if (priority < currentPriority) {
//                   upgradableStatuses.push(status);
//                 }
//               }
              
//               // Store for incremental update
//               statusChanges.set(messageId, newStatus);
              
//               bulkOps.push({
//                 updateOne: {
//                   filter: { 
//                     messageId,
//                     $or: [
//                       { status: { $exists: false } },
//                       { status: { $in: upgradableStatuses } }
//                     ]
//                   },
//                   update: {
//                     $set: {
//                       status: newStatus,
//                       lastWebhookAt: timestamp,
//                       ...updateFields
//                     },
//                     $inc: {
//                       ...(webhookData.suggestionResponse && { userClickCount: 1 }),
//                       ...(webhookData.rawPayload?.entity?.text && { userReplyCount: 1 })
//                     }
//                   },
//                   upsert: false
//                 }
//               });
//             }
//           }

//           // Get OLD status BEFORE bulk update for accurate incremental stats
//           const messageIds = Array.from(statusChanges.keys());
//           const oldStatusMap = new Map();
          
//           if (messageIds.length > 0) {
//             const existingMessages = await ContactCampaignMessage.find(
//               { messageId: { $in: messageIds } },
//               { messageId: 1, status: 1, campaignId: 1 }
//             ).lean();
            
//             for (const msg of existingMessages) {
//               oldStatusMap.set(msg.messageId, {
//                 oldStatus: msg.status || 'pending',
//                 campaignId: msg.campaignId
//               });
//             }
//           }

//           // Bulk update ContactCampaignMessage for this chunk
//           if (bulkOps.length > 0) {
//             try {
//               const result = await ContactCampaignMessage.bulkWrite(bulkOps, { ordered: false });
//               totalProcessed += result.modifiedCount;
//               console.log(`[StatsConsumer] Chunk ${chunkIndex + 1}/${chunks.length}: Updated ${result.modifiedCount} messages`);

//               // MINIMAL CPU: Just log affected campaigns, no queue
//               if (result.modifiedCount > 0) {
//                 console.log(`[StatsConsumer] ${result.modifiedCount} messages updated - stats will sync periodically`);
//               }
//             } catch (error) {
//               console.error(`[StatsConsumer] Chunk ${chunkIndex + 1} bulk write error:`, error.message);
//             }
//           }

//           await heartbeat(); // Heartbeat after bulk write

//           // Mark chunk logs as processed
//           try {
//             await MessageLog.updateMany(
//               { _id: { $in: chunk.map(l => l._id) } },
//               { $set: { processed: true, processedAt: new Date() } }
//             );
//           } catch (error) {
//             console.error(`[StatsConsumer] Chunk ${chunkIndex + 1} mark processed error:`, error.message);
//           }

//           await heartbeat(); // Heartbeat after marking processed
//         }

//         const duration = Date.now() - startTime;
//         console.log(`[StatsConsumer] Batch #${batchCount} complete in ${duration}ms | Total processed: ${totalProcessed}`);

//         // ACK batch
//         if (messages.length > 0) {
//           await resolveOffset(messages[messages.length - 1].offset);
//         }
//         await heartbeat();
//       }
//     });

//     // Log consumer status every 30 seconds
//     setInterval(() => {
//       console.log(`[StatsConsumer] Status: ${batchCount} batches processed | ${totalProcessed} messages updated`);
//     }, 30000);

//     const shutdown = async () => {
//       console.log('🛑 Shutting down stats consumer...');
//       await consumer.disconnect();
//       await mongoose.connection.close();
//       process.exit(0);
//     };

//     process.on('SIGTERM', shutdown);
//     process.on('SIGINT', shutdown);

//   } catch (error) {
//     console.error('❌ Stats consumer startup failed:', error);
//     process.exit(1);
//   }
// }

// startStatsConsumer();