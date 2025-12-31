import Bull from 'bull';
import { createClient } from 'redis';
import Campaign from '../models/campaign.model.js';
import Message from '../models/message.model.js';
import MessageLog from '../models/messageLog.model.js';
import CampaignStatsService from './CampaignStatsService.js';

const redisClient = createClient({
  url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`
});

redisClient.on('error', (err) => console.error('[Worker] Redis Client Error:', err));
redisClient.connect();

class BackgroundWorkerService {
  constructor() {
    // Separate queues for different tasks
    this.statsQueue = new Bull('background-stats-sync', {
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
    // Stats sync worker
    this.statsQueue.process('sync-stats', 1, async (job) => {
      await this.syncCampaignStats();
    });

    // Cleanup worker
    this.statsQueue.process('cleanup-data', 1, async (job) => {
      await this.cleanupOldData();
    });

    console.log('✅ Background workers initialized');
  }



  // Sync stats from Redis to MongoDB
  async syncCampaignStats() {
    try {
      await CampaignStatsService.syncAllCampaignStats();
      console.log('[Worker] 📊 Campaign stats synced to database');
    } catch (error) {
      console.error('[Worker] ❌ Error syncing campaign stats:', error);
    }
  }

  // Cleanup old data
  async cleanupOldData() {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      
      // Delete old messages
      const deletedMessages = await Message.deleteMany({
        createdAt: { $lt: thirtyDaysAgo },
        status: { $in: ['delivered', 'failed', 'bounced'] }
      });
      
      // Delete old message logs
      const deletedLogs = await MessageLog.deleteMany({
        timestamp: { $lt: thirtyDaysAgo }
      });
      
      console.log(`[Worker] 🧹 Cleanup completed: ${deletedMessages.deletedCount} messages, ${deletedLogs.deletedCount} logs`);
    } catch (error) {
      console.error('[Worker] ❌ Error during cleanup:', error);
    }
  }

  // Schedule periodic tasks
  schedulePeriodicTasks() {
    // Sync stats every 10 minutes (avoid conflict with CampaignStatsService)
    this.statsQueue.add('sync-stats', {}, {
      repeat: { cron: '*/10 * * * *' }
    });

    // Cleanup old data daily at 2 AM
    this.statsQueue.add('cleanup-data', {}, {
      repeat: { cron: '0 2 * * *' }
    });
    
    console.log('[Worker] ⏰ Periodic tasks scheduled');
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


}

// Export class, not instance (for proper instantiation in worker.js)
export default BackgroundWorkerService;