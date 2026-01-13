import mongoose from 'mongoose';
import { Kafka } from 'kafkajs';
import connectDB from '../db/index.js';
import pLimit from 'p-limit';

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
      groupId: 'batch-entries-processor',
      sessionTimeout: 30000,
      heartbeatInterval: 3000
    });
    
    await consumer.connect();
    await consumer.subscribe({ topic: 'campaign-batch-entries', fromBeginning: false });
    console.log('✅ Batch Entries Consumer subscribed to campaign-batch-entries');
    
    const ContactCampaignMessage = (await import('../models/contact_campaign_message.model.js')).default;
    
    let totalProcessed = 0;
    
    await consumer.run({
      partitionsConsumedConcurrently: 5,
      eachBatchAutoResolve: false,
      eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning, isStale }) => {
        const startTime = Date.now();
        const messages = batch.messages;
        
        console.log(`[BatchConsumer] Processing ${messages.length} batch entries`);
        
        for (const message of messages) {
          if (!isRunning() || isStale()) break;
          
          try {
            const batchData = JSON.parse(message.value.toString());
            const { subCampaigns, templateId, userId } = batchData;
            
            // Convert ObjectIds to strings for consistency
            const templateIdStr = templateId?.toString ? templateId.toString() : templateId;
            const userIdStr = userId?.toString ? userId.toString() : userId;
            
            console.log(`[BatchConsumer] Processing ${subCampaigns.length} sub-campaigns`);
            
            // Process sub-campaigns in parallel with concurrency limit
            const limit = pLimit(5);
            const CHUNK_SIZE = 1000;
            
            await Promise.all(
              subCampaigns.map((subCampaign, index) =>
                limit(async () => {
                  const { campaignId, phoneNumbers } = subCampaign;
                  
                  // Convert campaignId to string
                  const campaignIdStr = campaignId?.toString ? campaignId.toString() : campaignId;
                  
                  // Split phone numbers into chunks for better performance
                  const chunks = [];
                  for (let i = 0; i < phoneNumbers.length; i += CHUNK_SIZE) {
                    chunks.push(phoneNumbers.slice(i, i + CHUNK_SIZE));
                  }
                  
                  // Process chunks sequentially for each sub-campaign
                  for (const chunk of chunks) {
                    const { v4: uuidv4 } = await import('uuid');
                    
                    const bulkOps = chunk.map(phone => {
                      const cleanPhone = phone.replace(/^\+?91/, '').replace(/\D/g, '');
                      return {
                        updateOne: {
                          filter: { recipientPhoneNumber: cleanPhone, userId: userIdStr },
                          update: {
                            $setOnInsert: { recipientPhoneNumber: cleanPhone, userId: userIdStr },
                            $push: {
                              campaigns: {
                                campaignId: campaignIdStr,
                                templateId: templateIdStr,
                                messageId: uuidv4(),
                                status: 'draft',
                                queuedAt: new Date()
                              }
                            },
                            $addToSet: { campaignIds: campaignIdStr }
                          },
                          upsert: true
                        }
                      };
                    });
                    
                    // Execute bulk write with retry
                    let retries = 3;
                    while (retries > 0) {
                      try {
                        await ContactCampaignMessage.bulkWrite(bulkOps, {
                          ordered: false,
                          writeConcern: { w: 1, j: false }
                        });
                        break;
                      } catch (error) {
                        retries--;
                        if (retries === 0) throw error;
                        await new Promise(resolve => setTimeout(resolve, 500));
                      }
                    }
                  }
                  
                  console.log(`[BatchConsumer] ✅ Sub-campaign ${index + 1} processed: ${phoneNumbers.length} contacts`);
                })
              )
            );
            
            totalProcessed += subCampaigns.reduce((sum, sc) => sum + sc.phoneNumbers.length, 0);
            
            const duration = Date.now() - startTime;
            console.log(`[BatchConsumer] ✅ Batch complete: ${subCampaigns.length} sub-campaigns in ${duration}ms | Total: ${totalProcessed}`);
            
            await resolveOffset(message.offset);
            
          } catch (error) {
            console.error('[BatchConsumer] Processing error:', error.message);
            await resolveOffset(message.offset);
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