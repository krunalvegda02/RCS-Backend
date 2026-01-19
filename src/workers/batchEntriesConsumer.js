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
    const campaignChunks = new Map(); // Track: campaignId -> { total, completed: Set() }
    
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
            
            // Fetch all existing contacts for this user in one query
            const cleanPhones = phoneNumbers.map(phone => phone.replace(/^\+?91/, '').replace(/\D/g, ''));
            const existingContacts = await ContactCampaignMessage.find({
              recipientPhoneNumber: { $in: cleanPhones },
              userId
            }).lean();
            
            // Create a map for quick lookup
            const contactMap = new Map();
            existingContacts.forEach(contact => {
              contactMap.set(contact.recipientPhoneNumber, contact);
            });
            
            const bulkOps = [];
            let skippedDuplicates = 0;
            
            for (const phone of phoneNumbers) {
              const cleanPhone = phone.replace(/^\+?91/, '').replace(/\D/g, '');
              const messageId = uuidv4();
              const existingContact = contactMap.get(cleanPhone);
              
              if (!existingContact) {
                // Insert new contact
                bulkOps.push({
                  insertOne: {
                    document: {
                      recipientPhoneNumber: cleanPhone,
                      userId,
                      campaignIds: [campaignId],
                      campaigns: [{
                        campaignId,
                        templateId,
                        messageId,
                        status: 'pending',
                        queuedAt: new Date(),
                        userClickCount: 0,
                        userReplyCount: 0
                      }]
                    }
                  }
                });
              } else {
                // Always use updateOne with $ne filter - let MongoDB handle duplicate prevention
                bulkOps.push({
                  updateOne: {
                    filter: { 
                      recipientPhoneNumber: cleanPhone,
                      userId,
                      'campaigns.campaignId': { $ne: new mongoose.Types.ObjectId(campaignId) }
                    },
                    update: {
                      $push: {
                        campaigns: {
                          campaignId,
                          templateId,
                          messageId,
                          status: 'pending',
                          queuedAt: new Date(),
                          userClickCount: 0,
                          userReplyCount: 0
                        }
                      },
                      $addToSet: { campaignIds: campaignId }
                    }
                  }
                });
              }
            }
            
            console.log(`[BatchConsumer] 📝 Prepared ${bulkOps.length} bulk operations for ${phoneNumbers.length} contacts`);
            console.log(`[BatchConsumer] 🔍 Sample operation:`, JSON.stringify(bulkOps[0], null, 2));
            
            if (bulkOps.length > 0) {
              try {
                const result = await ContactCampaignMessage.bulkWrite(bulkOps, {
                  ordered: false,
                  writeConcern: { w: 1, j: false }
                });
                console.log(`[BatchConsumer] 💾 BulkWrite result:`, JSON.stringify(result, null, 2));
                console.log(`[BatchConsumer] 💾 Summary: inserted=${result.insertedCount}, modified=${result.modifiedCount}, matched=${result.matchedCount}`);
                
                const skippedDuplicates = bulkOps.length - result.insertedCount - result.modifiedCount;
                if (skippedDuplicates > 0) {
                  console.log(`[BatchConsumer] ⚠️ Skipped ${skippedDuplicates} duplicate campaign entries (already exist in DB)`);
                }
              } catch (bulkError) {
                console.error(`[BatchConsumer] ❌ BulkWrite error:`, bulkError.message);
                if (bulkError.writeErrors) {
                  console.error(`[BatchConsumer] ❌ Write errors:`, bulkError.writeErrors.slice(0, 3));
                }
                throw bulkError;
              }
            } else {
              console.log(`[BatchConsumer] ⚠️ No bulk operations to perform - all contacts already exist with this campaign`);
            }
            
            totalProcessed += phoneNumbers.length;
            const duration = Date.now() - startTime;
            console.log(`[BatchConsumer] ✅ Chunk ${chunkIndex + 1}/${totalChunks} completed: ${phoneNumbers.length} contacts in ${duration}ms | Total: ${totalProcessed}`);
            
            return { offset: message.offset, campaignId, totalChunks, chunkIndex };
          } catch (error) {
            console.error('[BatchConsumer] ❌ Processing error:', error.message);
            return null;
          }
        });
        
        const results = await Promise.all(processPromises);
        
        // Track chunks and update status after all messages in batch are processed
        for (const result of results) {
          if (result) {
            const { offset, campaignId, totalChunks, chunkIndex } = result;
            
            const campaignKey = campaignId.toString();
            if (!campaignChunks.has(campaignKey)) {
              campaignChunks.set(campaignKey, { total: totalChunks, completed: new Set() });
            }
            campaignChunks.get(campaignKey).completed.add(chunkIndex);
            
            console.log(`[BatchConsumer] Campaign ${campaignKey}: Chunk ${chunkIndex + 1}/${totalChunks} tracked. Completed: ${campaignChunks.get(campaignKey).completed.size}`);
            
            await resolveOffset(offset);
          }
        }
        
        // Check if any campaign completed all chunks
        for (const [campaignKey, progress] of campaignChunks.entries()) {
          console.log(`[BatchConsumer] 🔍 Checking campaign ${campaignKey}: ${progress.completed.size}/${progress.total} chunks completed`);
          console.log(`[BatchConsumer] 🔍 Completed chunk indexes:`, Array.from(progress.completed).sort((a,b) => a-b));
          
          if (progress.completed.size === progress.total) {
            const Campaign = (await import('../models/campaign.model.js')).default;
            
            // Count actual contacts inserted
            const contactCount = await ContactCampaignMessage.countDocuments({
              'campaigns.campaignId': new mongoose.Types.ObjectId(campaignKey)
            });
            
            console.log(`[BatchConsumer] 📊 Campaign ${campaignKey}: ${contactCount} contacts in database`);
            
            // Sync stats efficiently using aggregation
            const aggregatedStats = await ContactCampaignMessage.aggregate([
              { $match: { 'campaigns.campaignId': new mongoose.Types.ObjectId(campaignKey) } },
              { $unwind: '$campaigns' },
              { $match: { 'campaigns.campaignId': new mongoose.Types.ObjectId(campaignKey) } },
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
            
            // Update campaign with stats and status in one operation
            const campaign = await Campaign.findByIdAndUpdate(
              campaignKey,
              {
                status: 'pending',
                'stats.total': stats.total,
                'stats.pending': stats.pending,
                'stats.sent': stats.sent,
                'stats.delivered': stats.delivered,
                'stats.read': stats.read,
                'stats.replied': stats.replied,
                'stats.failed': stats.failed,
                'stats.bounced': 0
              },
              { new: true }
            );
            
            console.log(`[BatchConsumer] ✅✅✅ Campaign ${campaignKey} ALL ${progress.total} chunks completed`);
            console.log(`[BatchConsumer] 📊 Final Stats: total=${stats.total}, pending=${stats.pending}, sent=${stats.sent}, delivered=${stats.delivered}, read=${stats.read}, replied=${stats.replied}, failed=${stats.failed}`);
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