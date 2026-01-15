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
      groupId: `batch-entries-processor-${process.env.NODE_ENV || 'dev'}`,
      sessionTimeout: 30000,
      heartbeatInterval: 3000
    });
    
    await consumer.connect();
    await consumer.subscribe({ topic: 'campaign-batch-entries', fromBeginning: true });
    console.log('✅ Batch Entries Consumer subscribed to campaign-batch-entries');
    
    const ContactCampaignMessage = (await import('../models/contact_campaign_message.model.js')).default;
    
    let totalProcessed = 0;
    const campaignChunksProcessed = new Map();
    
    await consumer.run({
      partitionsConsumedConcurrently: 4,
      eachBatchAutoResolve: false,
      eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning, isStale }) => {
        const startTime = Date.now();
        const messages = batch.messages;
        const { v4: uuidv4 } = await import('uuid');
        
        // Process all messages in parallel
        const processPromises = messages.map(async (message) => {
          if (!isRunning() || isStale()) return null;
          
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
                        status: 'draft',
                        queuedAt: new Date()
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
              writeConcern: { w: 1, j: false }
            });
            
            totalProcessed += phoneNumbers.length;
            const duration = Date.now() - startTime;
            console.log(`[BatchConsumer] ✅ Chunk ${chunkIndex + 1}/${totalChunks} completed: ${phoneNumbers.length} contacts in ${duration}ms | Total: ${totalProcessed}`);
            
            // Track processed chunks per campaign
            const campaignKey = campaignId.toString();
            if (!campaignChunksProcessed.has(campaignKey)) {
              campaignChunksProcessed.set(campaignKey, { processed: new Set(), total: totalChunks });
            }
            campaignChunksProcessed.get(campaignKey).processed.add(chunkIndex);
            
            // Check if all chunks for this campaign are processed
            const campaignProgress = campaignChunksProcessed.get(campaignKey);
            if (campaignProgress.processed.size === campaignProgress.total) {
              const Campaign = (await import('../models/campaign.model.js')).default;
              await Campaign.findByIdAndUpdate(campaignId, { status: 'pending' });
              console.log(`[BatchConsumer] ✅ Campaign ${campaignId} ALL ${campaignProgress.total} chunks completed - status updated to 'pending'`);
              campaignChunksProcessed.delete(campaignKey);
            }
            
            return message.offset;
          } catch (error) {
            console.error('[BatchConsumer] ❌ Processing error:', error.message);
            return null;
          }
        });
        
        const offsets = await Promise.all(processPromises);
        
        // Commit all successful offsets
        for (let i = 0; i < offsets.length; i++) {
          if (offsets[i] !== null) {
            await resolveOffset(offsets[i]);
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