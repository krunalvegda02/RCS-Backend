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
            const messageId = data?.entity?.messageId || data?.messageId;
            const eventType = data?.entity?.eventType || data?.eventType;
            
            parsedData.push({
              offset: message.offset,
              messageId,
              entityType: data?.entityType,
              eventType,
              phoneNumber: data?.userPhoneNumber || data?.entity?.userPhoneNumber,
              suggestionResponse: data?.entity?.suggestionResponse,
              rawPayload: data,
              timestamp: webhookData.timestamp
            });
            
            console.log(`[KafkaConsumer] Parsed webhook: messageId=${messageId}, eventType=${eventType}`);
          } catch (error) {
            console.error('[KafkaConsumer] Parse error:', error.message);
            await resolveOffset(message.offset);
          }
        }
        
        // Step 2: Batch query all messageIds
        const messageIds = parsedData.map(p => p.messageId).filter(Boolean);
        console.log(`[KafkaConsumer] Querying ${messageIds.length} messageIds:`, messageIds.slice(0, 5));
        
        if (messageIds.length === 0) {
          console.log('[KafkaConsumer] No messageIds to process');
          await heartbeat();
          return;
        }
        
        const messageDocs = await ContactCampaignMessage.find({
          $or: [
            { 'campaigns.messageId': { $in: messageIds } },
            { 'campaigns.jioMessageId': { $in: messageIds } },
            { 'campaigns.rcsMessageId': { $in: messageIds } }
          ]
        }, { userId: 1, recipientPhoneNumber: 1, campaigns: 1 }).lean();
        
        console.log(`[KafkaConsumer] Found ${messageDocs.length} matching messages in DB`);
        
        // DIAGNOSTIC: Log first few messageIds being searched
        if (messageDocs.length === 0 && messageIds.length > 0) {
          console.log(`[KafkaConsumer] ❌ NO MATCHES! Searching for messageIds:`, messageIds.slice(0, 3));
          
          // Fallback: Try phone number matching for recent messages
          const phoneNumbers = parsedData.map(p => p.phoneNumber?.replace(/^\+91/, '')).filter(Boolean);
          if (phoneNumbers.length > 0) {
            const recentTime = new Date(Date.now() - 3600000); // Last hour
            const phoneMatches = await ContactCampaignMessage.find({
              recipientPhoneNumber: { $in: phoneNumbers },
              'campaigns.sentAt': { $gte: recentTime }
            }).lean();
            
            console.log(`[KafkaConsumer] Phone fallback found ${phoneMatches.length} recent messages`);
            
            if (phoneMatches.length > 0) {
              messageDocs.push(...phoneMatches);
            }
          }
          
          // Still no matches? Check sample
          if (messageDocs.length === 0) {
            const anyMessage = await ContactCampaignMessage.findOne({}).select('campaigns.messageId campaigns.jioMessageId').lean();
            if (anyMessage) {
              console.log(`[KafkaConsumer] Sample DB messageId:`, anyMessage.campaigns?.[0]?.messageId);
              console.log(`[KafkaConsumer] Sample DB jioMessageId:`, anyMessage.campaigns?.[0]?.jioMessageId);
            } else {
              console.log(`[KafkaConsumer] ❌ NO MESSAGES IN DATABASE AT ALL!`);
            }
          }
        }

        
        const messageMap = {};
        messageDocs.forEach(doc => {
          doc.campaigns?.forEach(camp => {
            // Match by any ID field
            if (camp.messageId) messageMap[camp.messageId] = { userId: doc.userId, campaignId: camp.campaignId };
            if (camp.jioMessageId) messageMap[camp.jioMessageId] = { userId: doc.userId, campaignId: camp.campaignId };
            if (camp.rcsMessageId) messageMap[camp.rcsMessageId] = { userId: doc.userId, campaignId: camp.campaignId };
          });
        });
        
        console.log(`[KafkaConsumer] Built messageMap with ${Object.keys(messageMap).length} entries`);
        
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
        
        console.log(`[KafkaConsumer] Batch summary: ${logsToInsert.length} to insert, ${skippedCount} skipped`);
        
        if (skippedCount > 0) {
          console.log(`[KafkaConsumer] ⚠️  Skipped ${skippedCount} webhooks | Total: Processed=${totalProcessed}, Skipped=${totalSkipped}`);
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
              console.log(`[KafkaConsumer] ✅ Inserted ${logsToInsert.length} logs in ${duration}ms | Total processed: ${totalProcessed}`);
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
