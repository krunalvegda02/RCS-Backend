import mongoose from 'mongoose';
import { connectConsumer, disconnectKafka } from '../services/kafka.service.js';
import connectDB from '../db/index.js';

process.env.WORKER_MODE = 'true';

async function startKafkaConsumer() {
  try {
    await connectDB();
    console.log('✅ Kafka Consumer connected to MongoDB');
    
    const consumer = await connectConsumer();
    const MessageLog = (await import('../models/messageLog.model.js')).default;
    const ContactCampaignMessage = (await import('../models/message.model.js')).default;
    
    let totalProcessed = 0;
    let totalSkipped = 0;
    
    await consumer.run({
      partitionsConsumedConcurrently: 10,
      eachBatchAutoResolve: false,
      eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning, isStale }) => {
        const startTime = Date.now();
        const maxBatchSize = 500;
        const messages = batch.messages.slice(0, maxBatchSize);
        
        // Step 1: Parse all webhooks
        const parsedData = [];
        for (const message of messages) {
          if (!isRunning() || isStale()) break;
          
          try {
            const webhookData = JSON.parse(message.value.toString());
            const data = webhookData.data;
            parsedData.push({
              offset: message.offset,
              messageId: data?.entity?.messageId || data?.messageId,
              entityType: data?.entityType,
              eventType: data?.entity?.eventType || data?.eventType,
              phoneNumber: data?.userPhoneNumber || data?.entity?.userPhoneNumber,
              suggestionResponse: data?.entity?.suggestionResponse,
              rawPayload: data,
              timestamp: webhookData.timestamp
            });
          } catch (error) {
            await resolveOffset(message.offset);
          }
        }
        
        // Step 2: Batch query all messageIds
        const messageIds = parsedData.map(p => p.messageId).filter(Boolean);
        if (messageIds.length === 0) {
          await heartbeat();
          return;
        }
        
        const messageDocs = await ContactCampaignMessage.find(
          { 'campaigns.messageId': { $in: messageIds } },
          { userId: 1, 'campaigns.messageId': 1, 'campaigns.campaignId': 1 }
        ).lean();
        
        const messageMap = {};
        messageDocs.forEach(doc => {
          doc.campaigns?.forEach(camp => {
            if (camp.messageId) {
              messageMap[camp.messageId] = {
                userId: doc.userId,
                campaignId: camp.campaignId
              };
            }
          });
        });
        
        // Step 3: Build logs array
        const logsToInsert = [];
        const offsetsToCommit = [];
        let skippedCount = 0;
        
        for (const parsed of parsedData) {
          const msgInfo = messageMap[parsed.messageId];
          if (msgInfo?.userId) {
            logsToInsert.push({
              messageId: parsed.messageId,
              campaignId: msgInfo.campaignId,
              userId: msgInfo.userId,
              eventType: parsed.entityType === 'USER_MESSAGE' ? 'user_interaction' : 'status_update',
              status: 'success',
              webhookData: {
                eventType: parsed.eventType,
                phoneNumber: parsed.phoneNumber,
                interactionType: parsed.entityType === 'USER_MESSAGE' ? 'text_reply' : undefined,
                suggestionResponse: parsed.suggestionResponse,
                rawPayload: parsed.rawPayload
              },
              processed: false,
              timestamp: new Date(parsed.timestamp),
              metadata: { source: 'webhook' }
            });
            offsetsToCommit.push(parsed.offset);
          } else {
            skippedCount++;
            await resolveOffset(parsed.offset);
          }
        }
        
        totalSkipped += skippedCount;
        totalProcessed += logsToInsert.length;
        
        if (skippedCount > 0) {
          console.log(`[Kafka] ⚠️  Skipped ${skippedCount} webhooks | Total: Processed=${totalProcessed}, Skipped=${totalSkipped}`);
        }
        
        // Step 4: Bulk insert with retry
        if (logsToInsert.length > 0) {
          let retries = 3;
          let success = false;
          
          while (retries > 0) {
            try {
              await MessageLog.insertMany(logsToInsert, { ordered: false });
              success = true;
              const duration = Date.now() - startTime;
              console.log(`[Kafka] ✅ ${logsToInsert.length} logs in ${duration}ms`);
              break;
            } catch (bulkError) {
              retries--;
              if (retries === 0) {
                await heartbeat();
                console.error('[Kafka] Bulk insert failed after retries:', bulkError.message);
                throw bulkError;
              }
              await new Promise(r => setTimeout(r, 500));
            }
          }
          
          // CRITICAL: Resolve highest offset only (commits all previous)
          if (success && offsetsToCommit.length > 0) {
            const highestOffset = Math.max(...offsetsToCommit.map(Number));
            await resolveOffset(highestOffset.toString());
          }
        }
        
        await heartbeat();
      }
    });

    const shutdown = async () => {
      console.log('🛑 Shutting down Kafka consumer...');
      await disconnectKafka();
      await mongoose.connection.close();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

  } catch (error) {
    console.error('❌ Kafka consumer startup failed:', error);
    process.exit(1);
  }
}

startKafkaConsumer();
