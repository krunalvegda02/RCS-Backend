import mongoose from 'mongoose';
import { Kafka } from 'kafkajs';
import connectDB from '../db/index.js';

process.env.WORKER_MODE = 'true';

async function startBatchEntriesConsumer() {
  try {
    await connectDB();
    console.log('✅ Batch Entries Consumer connected to MongoDB');
    
    const kafka = new Kafka({
      clientId: 'batch-entries-consumer',
      brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
      retry: {
        initialRetryTime: 100,
        retries: 8
      }
    });
    
    const consumer = kafka.consumer({ 
      groupId: `batch-entries-processor-production-v3`,
      sessionTimeout: 600000, // 10 minutes
      heartbeatInterval: 3000 // 3 seconds
    });
    
    await consumer.connect();
    await consumer.subscribe({ topic: 'campaign-batch-entries', fromBeginning: false });
    console.log('✅ Batch Entries Consumer subscribed to campaign-batch-entries');
    
    const ContactCampaignMessage = (await import('../models/contact_campaign_message.model.js')).default;
    
    let totalProcessed = 0;
    const campaignChunks = new Map();
    
    await consumer.run({
      partitionsConsumedConcurrently: 3,
      eachBatchAutoResolve: false,
      eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning, isStale }) => {
        const startTime = Date.now();
        const messages = batch.messages;
        const { v4: uuidv4 } = await import('uuid');
        
        // Process messages with heartbeats between each
        const results = [];
        for (const message of messages) {
          if (!isRunning() || isStale()) {
            results.push(null);
            continue;
          }
          
          try {
            const batchData = JSON.parse(message.value.toString());
            const { campaignId, templateId, userId, phoneNumbers, totalChunks, chunkIndex } = batchData;
            
            console.log(`[BatchConsumer] Processing chunk ${chunkIndex + 1}/${totalChunks} (${phoneNumbers.length} contacts) for campaign ${campaignId}`);
            
            const bulkOps = phoneNumbers.map(phone => {
              const cleanPhone = phone.replace(/^\+?91/, '').replace(/\D/g, '');
              return {
                updateOne: {
                  filter: { recipientPhoneNumber: cleanPhone, userId },
                  update: {
                    $setOnInsert: { recipientPhoneNumber: cleanPhone, userId },
                    $addToSet: { 
                      campaigns: {
                        campaignId,
                        templateId,
                        messageId: uuidv4(),
                        status: 'pending',
                        queuedAt: new Date(),
                        userClickCount: 0,
                        userReplyCount: 0
                      },
                      campaignIds: campaignId 
                    }
                  },
                  upsert: true
                }
              };
            });
            
            await ContactCampaignMessage.bulkWrite(bulkOps, {
              ordered: false,
              writeConcern: { w: 0 }
            });
            
            totalProcessed += phoneNumbers.length;
            const duration = Date.now() - startTime;
            console.log(`[BatchConsumer] ✅ Chunk ${chunkIndex + 1}/${totalChunks} completed: ${phoneNumbers.length} contacts in ${duration}ms | Total: ${totalProcessed}`);
            
            results.push({ offset: message.offset, campaignId, totalChunks, chunkIndex });
            await heartbeat(); // Heartbeat after each chunk
          } catch (error) {
            console.error('[BatchConsumer] ❌ Processing error:', error.message);
            results.push(null);
          }
        }
        
        for (const result of results) {
          if (result) {
            const { offset, campaignId, totalChunks, chunkIndex } = result;
            
            const campaignKey = campaignId.toString();
            if (!campaignChunks.has(campaignKey)) {
              campaignChunks.set(campaignKey, { total: totalChunks, completed: new Set() });
            }
            campaignChunks.get(campaignKey).completed.add(chunkIndex);
            
            await resolveOffset(offset);
          }
        }
        
        for (const [campaignKey, progress] of campaignChunks.entries()) {
          if (progress.completed.size === progress.total) {
            const Campaign = (await import('../models/campaign.model.js')).default;
            await Campaign.findByIdAndUpdate(campaignKey, { status: 'pending' });
            console.log(`[BatchConsumer] ✅✅✅ Campaign ${campaignKey}: ALL ${progress.total} chunks completed - STATUS UPDATED TO PENDING ✅✅✅`);
            campaignChunks.delete(campaignKey);
          }
        }
        
        await heartbeat();
      }
    });
    
    const shutdown = async () => {
      console.log('🛑 Shutting down batch entries consumer...');
      await consumer.disconnect();
      await mongoose.connection.close();
      process.exit(0);
    };
    
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    
  } catch (error) {
    console.error('❌ Batch entries consumer startup failed:', error);
    process.exit(1);
  }
}

startBatchEntriesConsumer();
