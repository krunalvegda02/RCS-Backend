import Bull from 'bull';
import redis from 'redis';
import Campaign from '../models/campaign.model.js';
import Message from '../models/message.model.js';
import jioRCSService from './JioRCS.service.js';

const redisClient = redis.createClient({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
});

class BackgroundWorkerService {
  constructor() {
    // Separate queues for different tasks
    this.campaignQueue = new Bull('campaign-processing', {
      redis: { host: process.env.REDIS_HOST, port: process.env.REDIS_PORT },
      defaultJobOptions: {
        removeOnComplete: 10,
        removeOnFail: 50,
      },
    });

    this.statsQueue = new Bull('stats-sync', {
      redis: { host: process.env.REDIS_HOST, port: process.env.REDIS_PORT },
      defaultJobOptions: {
        removeOnComplete: 5,
        removeOnFail: 10,
      },
    });

    this.setupWorkers();
    this.schedulePeriodicTasks();
  }

  setupWorkers() {
    // Campaign processing worker (high concurrency)
    this.campaignQueue.process('process-batch', 50, async (job) => {
      const { campaignId, batchNumber } = job.data;
      await this.processCampaignBatch(campaignId, batchNumber);
    });

    // Stats sync worker (low concurrency)
    this.statsQueue.process('sync-stats', 1, async (job) => {
      await this.syncCampaignStats();
    });

    // Cleanup worker
    this.statsQueue.process('cleanup-data', 1, async (job) => {
      await this.cleanupOldData();
    });
  }

  // Process campaign in background
  async processCampaignBatch(campaignId, batchNumber) {
    try {
      const campaign = await Campaign.findById(campaignId).populate('templateId');
      if (!campaign || campaign.status !== 'running') return;

      const batchSize = 1000; // Larger batches for background processing
      const skip = batchNumber * batchSize;
      
      // Get batch of recipients
      const recipients = campaign.recipients.slice(skip, skip + batchSize)
        .filter(r => r.status === 'pending' && r.isRcsCapable === true);

      if (recipients.length === 0) {
        // Mark campaign as completed
        await Campaign.updateOne(
          { _id: campaignId },
          { status: 'completed', completedAt: new Date() }
        );
        return;
      }

      // Process recipients in parallel (chunks of 100)
      const chunks = this.chunkArray(recipients, 100);
      
      for (const chunk of chunks) {
        await Promise.all(chunk.map(async (recipient) => {
          try {
            // Create message record
            const messageId = this.generateUUID();
            await Message.create({
              messageId,
              campaignId,
              userId: campaign.userId,
              recipientPhoneNumber: recipient.phoneNumber,
              templateId: campaign.templateId._id,
              templateType: campaign.templateId.templateType,
              content: campaign.templateId.content,
              variables: recipient.variables,
              status: 'queued',
              cost: 1,
            });

            // Add to message sending queue
            await jioRCSService.messageQueue.add({
              messageData: {
                phoneNumber: recipient.phoneNumber,
                messageId,
                userId: campaign.userId,
                campaignId,
                templateId: campaign.templateId._id,
                templateType: campaign.templateId.templateType,
                content: campaign.templateId.content,
                variables: recipient.variables,
              }
            });

            // Update Redis counter
            await redisClient.hincrby(`campaign_stats:${campaignId}`, 'processing', 1);

          } catch (error) {
            console.error(`Error processing recipient ${recipient.phoneNumber}:`, error);
            await redisClient.hincrby(`campaign_stats:${campaignId}`, 'failed', 1);
          }
        }));

        // Rate limiting between chunks
        await this.sleep(2000);
      }

      // Schedule next batch
      if (skip + batchSize < campaign.recipients.length) {
        await this.campaignQueue.add('process-batch', {
          campaignId,
          batchNumber: batchNumber + 1
        }, { delay: 5000 });
      }

    } catch (error) {
      console.error(`Error processing campaign batch ${campaignId}:`, error);
    }
  }

  // Sync stats from Redis to MongoDB
  async syncCampaignStats() {
    try {
      const keys = await this.getRedisKeys('campaign_stats:*');
      
      // Process in batches to avoid memory issues
      const batches = this.chunkArray(keys, 50);
      
      for (const batch of batches) {
        const bulkOps = [];
        
        for (const key of batch) {
          const campaignId = key.replace('campaign_stats:', '');
          const stats = await redisClient.hgetall(key);
          
          if (Object.keys(stats).length > 0) {
            bulkOps.push({
              updateOne: {
                filter: { _id: campaignId },
                update: {
                  $inc: {
                    'stats.sent': parseInt(stats.delivered || 0),
                    'stats.failed': parseInt(stats.failed || 0),
                    'stats.processing': parseInt(stats.processing || 0),
                  }
                }
              }
            });
          }
        }
        
        if (bulkOps.length > 0) {
          await Campaign.bulkWrite(bulkOps);
          
          // Clear Redis counters after sync
          await Promise.all(batch.map(key => redisClient.del(key)));
        }
      }
    } catch (error) {
      console.error('Error syncing campaign stats:', error);
    }
  }

  // Cleanup old data
  async cleanupOldData() {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      
      // Delete old API results
      await Message.deleteMany({
        createdAt: { $lt: thirtyDaysAgo },
        status: { $in: ['delivered', 'failed'] }
      });
      
      console.log('Cleanup completed');
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }

  // Schedule periodic tasks
  schedulePeriodicTasks() {
    // Sync stats every 2 minutes
    this.statsQueue.add('sync-stats', {}, {
      repeat: { cron: '*/2 * * * *' }
    });

    // Cleanup old data daily at 2 AM
    this.statsQueue.add('cleanup-data', {}, {
      repeat: { cron: '0 2 * * *' }
    });
  }

  // Utility methods
  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  generateUUID() {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async getRedisKeys(pattern) {
    return new Promise((resolve, reject) => {
      redisClient.keys(pattern, (err, keys) => {
        if (err) reject(err);
        resolve(keys || []);
      });
    });
  }

  // Start campaign processing in background
  async startCampaignProcessing(campaignId) {
    await this.campaignQueue.add('process-batch', {
      campaignId,
      batchNumber: 0
    });
  }
}

export default new BackgroundWorkerService();