import ContactBatch from '../models/contactBatch.model.js';
import Template from '../models/template.model.js';
import jioRCSService from '../services/JioRCS.service.js';
import Bull from 'bull';
import Redis from 'ioredis';

// Redis client for caching with fallback
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 1,
});

// In-memory cache as fallback
const memoryCache = new Map();
let redisConnected = false;

// Test Redis connection
redis.on('connect', () => {
  console.log('[Redis] Connected successfully');
  redisConnected = true;
});

redis.on('error', (err) => {
  console.error('[Redis] Connection error:', err);
  redisConnected = false;
});

// Cache helper functions
const getFromCache = async (key) => {
  if (redisConnected) {
    try {
      return await redis.get(key);
    } catch (error) {
      console.error('[Cache] Redis get error:', error);
    }
  }
  return memoryCache.get(key);
};

const setToCache = async (key, value, ttl) => {
  if (redisConnected) {
    try {
      await redis.setex(key, ttl, value);
      return;
    } catch (error) {
      console.error('[Cache] Redis set error:', error);
    }
  }
  memoryCache.set(key, value);
  // Clean memory cache periodically
  if (memoryCache.size > 10000) {
    const keys = Array.from(memoryCache.keys());
    keys.slice(0, 5000).forEach(k => memoryCache.delete(k));
  }
};

// Cache TTL (7 days)
const CACHE_TTL = 7 * 24 * 60 * 60;

// Create capability check queue with rate limiting
const capabilityQueue = new Bull('capability-check', {
  redis: {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

// Upload contacts and start background capability check
export const uploadContacts = async (req, res) => {
  try {
    const { contacts, filename, campaignData } = req.body;
    const userId = req.user._id;

    console.log('[Upload] Request body:', { 
      contactsLength: contacts?.length, 
      filename, 
      campaignData,
      hasContacts: Array.isArray(contacts)
    });

    if (!Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Contacts array is required',
      });
    }

    // Rate limiting for large batches
    if (contacts.length > 100000) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 100,000 contacts allowed per batch',
      });
    }

    // Deduplication
    const uniqueContacts = [...new Map(
      contacts.map(phone => [phone.replace(/\D/g, ''), phone])
    ).values()];

    const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    console.log(`[Upload] Creating batch for ${uniqueContacts.length} contacts`);

    // Create batch record with campaign integration
    const batch = await ContactBatch.create({
      userId,
      batchId,
      filename,
      totalContacts: uniqueContacts.length,
      campaignId: campaignData?.campaignId,
      templateId: campaignData?.templateId,
      campaignName: campaignData?.campaignName,
      autoSendEnabled: !!campaignData?.autoSend,
      contacts: uniqueContacts.map(phone => ({
        phoneNumber: phone,
        status: 'pending',
        variables: campaignData?.variables || {}
      }))
    });

    // If campaign ID provided, update campaign with recipients
    if (campaignData?.campaignId) {
      try {
        const Campaign = (await import('../models/campaign.model.js')).default;
        await Campaign.findByIdAndUpdate(campaignData.campaignId, {
          $set: {
            recipients: uniqueContacts.map(phone => ({
              phoneNumber: phone,
              status: 'pending',
              variables: campaignData?.variables || {},
              isRcsCapable: null
            })),
            'stats.total': uniqueContacts.length,
            'stats.pending': uniqueContacts.length
          }
        });
        console.log(`[Upload] Updated campaign ${campaignData.campaignId} with ${uniqueContacts.length} recipients`);
      } catch (campaignError) {
        console.error(`[Upload] Failed to update campaign:`, campaignError.message);
      }
    }

    console.log(`[Upload] Batch created with ID: ${batch._id}`);

    // Enqueue capability check job with priority based on batch size
    const priority = uniqueContacts.length > 50000 ? 5 : uniqueContacts.length > 10000 ? 7 : 10;
    
    const jobResult = await capabilityQueue.add('check-batch-capability', {
      batchId,
      userId: userId.toString(),
      phoneNumbers: uniqueContacts,
      autoSend: !!campaignData?.autoSend
    }, {
      priority,
      delay: 100
    });

    console.log(`[Upload] Job queued with ID: ${jobResult.id}`);

    res.json({
      success: true,
      message: `Contacts uploaded successfully. Processing ${uniqueContacts.length} contacts in background.`,
      data: {
        batchId,
        totalContacts: uniqueContacts.length,
        duplicatesRemoved: contacts.length - uniqueContacts.length,
        autoSendEnabled: !!campaignData?.autoSend,
        estimatedTime: `${Math.ceil(uniqueContacts.length / 1000)} minutes`
      }
    });

  } catch (error) {
    console.error(`[Upload] Error creating batch:`, error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get batch progress
export const getBatchProgress = async (req, res) => {
  try {
    const { batchId } = req.params;
    const userId = req.user._id;

    const batch = await ContactBatch.findOne({ batchId, userId });
    
    if (!batch) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found',
      });
    }

    // Update progress
    batch.updateProgress();
    await batch.save();

    const progressPercentage = batch.totalContacts > 0 
      ? Math.round((batch.processedContacts / batch.totalContacts) * 100)
      : 0;

    res.json({
      success: true,
      data: {
        batchId: batch.batchId,
        status: batch.status,
        progress: progressPercentage,
        totalContacts: batch.totalContacts,
        processedContacts: batch.processedContacts,
        rcsCapable: batch.rcsCapable,
        nonRcsCapable: batch.nonRcsCapable,
        errors: batch.errors,
        messagesSent: batch.contacts.filter(c => c.status === 'sent').length,
        messagesFailed: batch.contacts.filter(c => c.status === 'failed').length,
        isComplete: batch.status === 'completed' || batch.status === 'campaign_active',
        contacts: batch.status === 'completed' || batch.status === 'campaign_active' ? batch.contacts : undefined
      }
    });

  } catch (error) {
    console.error(`[Progress] Error fetching batch:`, error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Process capability check queue with rate limiting for 1 lakh contacts
capabilityQueue.process('check-batch-capability', 5, async (job) => {
  const { batchId, userId, phoneNumbers, autoSend } = job.data;
  
  try {
    const batch = await ContactBatch.findOne({ batchId });
    if (!batch) throw new Error('Batch not found');

    // Optimized rate limiting based on batch size
    const totalContacts = phoneNumbers.length;
    let concurrency, chunkSize, delayBetweenChunks;
    
    if (totalContacts <= 10000) {
      concurrency = 2;
      chunkSize = 100;
      delayBetweenChunks = Math.random() * 100 + 100; // 100-200ms
    } else if (totalContacts <= 50000) {
      concurrency = 3;
      chunkSize = 100;
      delayBetweenChunks = Math.random() * 200 + 300; // 300-500ms
    } else {
      // For >50k contacts, use existing large batch settings
      concurrency = 10;
      chunkSize = 100;
      delayBetweenChunks = 500;
    }
    
    console.log(`[Queue] 🚀 Starting capability check for batch ${batchId} (${phoneNumbers.length} contacts)`);
    console.log(`[Queue] ⚙️ Rate limiting config - Concurrency: ${concurrency}, Chunk size: ${chunkSize}, Delay: ${delayBetweenChunks}ms`);
    console.log(`[Queue] 📨 Auto-send enabled: ${autoSend}`);
    
    const chunks = chunkArray(phoneNumbers, chunkSize);
    let processed = 0;

    console.log(`[Queue] Processing ${phoneNumbers.length} contacts in ${chunks.length} chunks (${chunkSize} per chunk)`);

    for (const chunk of chunks) {
      const promises = chunk.map(async (phone) => {
        try {
          // Check cache first (Redis or memory)
          const cacheKey = `rcs_capability:${phone}`;
          let result = await getFromCache(cacheKey);
          
          if (result) {
            result = JSON.parse(result);
            console.log(`[Queue] Cache hit for ${phone}`);
          } else {
            // Not in cache, check capability
            result = await jioRCSService.checkCapabilityStatus(phone, userId);
            // Cache the result
            await setToCache(cacheKey, JSON.stringify(result), CACHE_TTL);
            console.log(`[Queue] Fresh check and cached for ${phone}`);
          }
          
          // Update contact in batch
          await ContactBatch.updateOne(
            { batchId, 'contacts.phoneNumber': phone },
            {
              $set: {
                'contacts.$.isCapable': result.isCapable,
                'contacts.$.capabilityToken': result.capabilityToken,
                'contacts.$.status': 'checked',
                'contacts.$.checkedAt': new Date()
              }
            }
          );

          // Auto-send message with rate limiting for large batches
          if (autoSend && result.isCapable && batch.campaignId && batch.templateId) {
            const isLargeBatch = phoneNumbers.length > 50000;
            const sendDelay = isLargeBatch ? Math.random() * 10000 : Math.random() * 2000;
            
            console.log(`[Queue] 📤 Scheduling auto-send message for ${phone} (delay: ${Math.round(sendDelay)}ms)`);
            
            setTimeout(async () => {
              try {
                const msgId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                console.log(`[Queue] 🚀 Sending auto-message to ${phone} (ID: ${msgId})`);
                
                // Get template data for message
                const template = await Template.findById(batch.templateId);
                if (!template) throw new Error('Template not found');
                
                // Send message via RCS service
                await jioRCSService.sendMessage({
                  phoneNumber: phone,
                  messageId: msgId,
                  userId,
                  campaignId: batch.campaignId,
                  templateType: template.templateType,
                  content: template.content,
                  capabilityToken: result.capabilityToken,
                  variables: batch.contacts.find(c => c.phoneNumber === phone)?.variables || {}
                });

                // Update contact status to sent
                await ContactBatch.updateOne(
                  { batchId, 'contacts.phoneNumber': phone },
                  {
                    $set: {
                      'contacts.$.status': 'sent',
                      'contacts.$.messageId': msgId,
                      'contacts.$.sentAt': new Date()
                    }
                  }
                );

                console.log(`[Queue] ✅ Auto-message sent successfully to ${phone}`);
              } catch (sendError) {
                console.error(`[Queue] ❌ Auto-send failed for ${phone}:`, sendError.message);
                // Update contact status to failed
                await ContactBatch.updateOne(
                  { batchId, 'contacts.phoneNumber': phone },
                  {
                    $set: {
                      'contacts.$.status': 'failed',
                      'contacts.$.error': sendError.message
                    }
                  }
                );
              }
            }, sendDelay);
          }

          processed++;
          
          // Update job progress
          const progressPercentage = Math.round((processed / phoneNumbers.length) * 100);
          job.progress(progressPercentage);

          // Log progress for large batches
          if (isLargeBatch && processed % 1000 === 0) {
            console.log(`[Queue] Processed ${processed}/${phoneNumbers.length} contacts (${progressPercentage}%)`);
          }

        } catch (error) {
          console.error(`[Queue] Capability check failed for ${phone}:`, error.message);
          // Update contact with error
          await ContactBatch.updateOne(
            { batchId, 'contacts.phoneNumber': phone },
            {
              $set: {
                'contacts.$.isCapable': false,
                'contacts.$.status': 'error',
                'contacts.$.error': error.message,
                'contacts.$.checkedAt': new Date()
              }
            }
          );
          processed++;
        }
      });

      await Promise.all(promises);
      
      // Delay between chunks - longer for large batches
      if (chunks.indexOf(chunk) < chunks.length - 1) {
        await sleep(delayBetweenChunks);
      }
    }

    // Mark batch as completed or campaign_active
    await ContactBatch.updateOne(
      { batchId },
      { 
        status: autoSend ? 'campaign_active' : 'completed',
        completedAt: new Date()
      }
    );

    console.log(`[Queue] ✅ Batch ${batchId} completed successfully`);
    console.log(`[Queue] 📊 Final stats - Processed: ${processed}, Auto-send: ${autoSend}`);
    return { success: true, processed, autoSend };

  } catch (error) {
    console.error(`[Queue] ❌ Batch ${batchId} failed:`, error.message);
    // Mark batch as failed
    await ContactBatch.updateOne(
      { batchId },
      { 
        status: 'failed',
        completedAt: new Date()
      }
    );
    throw error;
  }
});

// Helper functions
function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export { capabilityQueue };