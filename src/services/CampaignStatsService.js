import { createClient } from 'redis';
import mongoose from 'mongoose';
import Campaign from '../models/campaign.model.js';
import Message from '../models/message.model.js';

let redisClient = null;

try {
  redisClient = createClient({
    url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`,
    socket: {
      reconnectStrategy: (retries) => Math.min(retries * 50, 500)
    }
  });
  
  redisClient.on('error', (err) => console.error('[Stats] Redis Error:', err));
  redisClient.on('connect', () => console.log('[Stats] Redis Connected'));
  
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }
} catch (error) {
  console.error('[Stats] Redis connection failed:', error);
}

class CampaignStatsService {
  constructor() {
    this.batchSize = 100;
    this.syncInterval = 30000; // 30 seconds for high volume
  }

  // Alias for BackgroundWorkerService compatibility
  async syncAllCampaignStats() {
    return this.syncStatsToDatabase();
  }

  // High-performance batch sync with connection pooling
  async syncStatsToDatabase() {
    if (!redisClient?.isOpen) return;
    
    try {
      const keys = await redisClient.keys('campaign_stats:*');
      if (keys.length === 0) return;

      // Process in batches to avoid memory issues
      const batches = this.chunkArray(keys, this.batchSize);
      
      for (const batch of batches) {
        const bulkOps = [];
        const keysToDelete = [];
        
        for (const key of batch) {
          const campaignId = key.replace('campaign_stats:', '');
          
          // Validate ObjectId format
          if (!this.isValidObjectId(campaignId)) {
            console.warn(`[Stats] Invalid campaignId: ${campaignId}`);
            continue;
          }
          
          const stats = await redisClient.hGetAll(key);
          
          if (Object.keys(stats).length > 0) {
            // Safe parseInt with fallback to 0
            const safeInt = (val) => {
              const parsed = parseInt(val || '0', 10);
              return isNaN(parsed) ? 0 : parsed;
            };
            
            bulkOps.push({
              updateOne: {
                filter: { _id: campaignId },
                update: {
                  $inc: {
                    'stats.sent': safeInt(stats.sent),
                    'stats.delivered': safeInt(stats.delivered),
                    'stats.read': safeInt(stats.read),
                    'stats.replied': safeInt(stats.replied),
                    'stats.failed': safeInt(stats.failed),
                    'stats.bounced': safeInt(stats.bounced),
                    'stats.processing': safeInt(stats.processing),
                  },
                  $set: {
                    'stats.lastUpdatedAt': new Date()
                  }
                }
              }
            });
            
            keysToDelete.push(key);
          }
        }
        
        if (bulkOps.length > 0) {
          try {
            // Atomic DB update first
            await Campaign.bulkWrite(bulkOps, { ordered: false });
            
            // Only delete Redis keys after successful DB update
            if (keysToDelete.length > 0) {
              const pipeline = redisClient.multi();
              keysToDelete.forEach(key => pipeline.del(key));
              await pipeline.exec();
            }
          } catch (dbError) {
            console.error('DB bulk write failed, keeping Redis data:', dbError);
            // Don't delete Redis keys if DB update failed
          }
        }
      }
      
      console.log(`[Stats] Synced ${keys.length} campaign stats`);
    } catch (error) {
      console.error('Error syncing campaign stats:', error);
    }
  }

  // Real-time stats with fallback
  async getCampaignStats(campaignId) {
    try {
      // Validate ObjectId
      if (!this.isValidObjectId(campaignId)) {
        console.warn(`[Stats] Invalid campaignId: ${campaignId}`);
        return null;
      }
      
      const [campaign, redisStats] = await Promise.all([
        Campaign.findById(campaignId).lean(),
        redisClient?.isOpen ? redisClient.hGetAll(`campaign_stats:${campaignId}`) : {}
      ]);
      
      if (!campaign) return null;
      
      // Safe parseInt with fallback
      const safeInt = (val) => {
        const parsed = parseInt(val || '0', 10);
        return isNaN(parsed) ? 0 : parsed;
      };
      
      const realTimeStats = {
        total: campaign.recipients?.length || 0,
        sent: (campaign.stats?.sent || 0) + safeInt(redisStats.sent),
        delivered: (campaign.stats?.delivered || 0) + safeInt(redisStats.delivered),
        read: (campaign.stats?.read || 0) + safeInt(redisStats.read),
        replied: (campaign.stats?.replied || 0) + safeInt(redisStats.replied),
        failed: (campaign.stats?.failed || 0) + safeInt(redisStats.failed),
        bounced: (campaign.stats?.bounced || 0) + safeInt(redisStats.bounced),
        processing: (campaign.stats?.processing || 0) + safeInt(redisStats.processing),
      };
      
      // Correct pending calculation: total - all non-pending states
      realTimeStats.pending = Math.max(0, 
        realTimeStats.total - realTimeStats.sent - realTimeStats.delivered - 
        realTimeStats.read - realTimeStats.replied - realTimeStats.failed - 
        realTimeStats.bounced - realTimeStats.processing
      );
      
      // Success rate based on delivered vs sent
      realTimeStats.successRate = realTimeStats.sent > 0 ? 
        parseFloat(((realTimeStats.delivered / realTimeStats.sent) * 100).toFixed(2)) : 0;
      
      return realTimeStats;
    } catch (error) {
      console.error('Error getting campaign stats:', error);
      return null;
    }
  }

  // Increment stats atomically
  async incrementStat(campaignId, statType, count = 1) {
    if (!redisClient?.isOpen || !this.isValidObjectId(campaignId)) return;
    
    try {
      // Validate statType to prevent Redis key pollution
      const validStatTypes = ['sent', 'delivered', 'read', 'replied', 'failed', 'bounced', 'processing'];
      if (!validStatTypes.includes(statType)) {
        console.warn(`[Stats] Invalid statType: ${statType}`);
        return;
      }
      
      await redisClient.hIncrBy(`campaign_stats:${campaignId}`, statType, count);
      await redisClient.expire(`campaign_stats:${campaignId}`, 3600); // 1 hour TTL
    } catch (error) {
      console.error(`Error incrementing stat ${statType} for campaign ${campaignId}:`, error);
    }
  }


  
  // Get message delivery stats for real-time reporting
  async getMessageStats(userId, timeframe = '24h') {
    try {
      const timeAgo = new Date();
      if (timeframe === '24h') timeAgo.setHours(timeAgo.getHours() - 24);
      else if (timeframe === '7d') timeAgo.setDate(timeAgo.getDate() - 7);
      else if (timeframe === '30d') timeAgo.setDate(timeAgo.getDate() - 30);
      
      const stats = await Message.aggregate([
        {
          $match: {
            userId: new mongoose.Types.ObjectId(userId),
            createdAt: { $gte: timeAgo }
          }
        },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalCost: { $sum: '$cost' }
          }
        }
      ]);
      
      const result = {
        totalMessages: 0,
        totalSuccessCount: 0,
        totalFailedCount: 0,
        pendingMessages: 0,
        totalCost: 0
      };
      
      stats.forEach(stat => {
        result.totalMessages += stat.count;
        result.totalCost += stat.totalCost || 0;
        
        if (['delivered', 'read', 'replied'].includes(stat._id)) {
          result.totalSuccessCount += stat.count;
        } else if (['failed', 'bounced'].includes(stat._id)) {
          result.totalFailedCount += stat.count;
        } else if (['queued', 'pending', 'processing'].includes(stat._id)) {
          result.pendingMessages += stat.count;
        }
      });
      
      return result;
    } catch (error) {
      console.error('Error getting message stats:', error);
      return null;
    }
  }

  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  // Validate MongoDB ObjectId format
  isValidObjectId(id) {
    if (!id || typeof id !== 'string') return false;
    return /^[0-9a-fA-F]{24}$/.test(id);
  }

  // Graceful shutdown
  async cleanup() {
    try {
      if (this.syncTimer) clearInterval(this.syncTimer);
      if (redisClient?.isOpen) {
        await redisClient.quit();
      }
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  }
}

// Enhanced periodic sync with error recovery
const statsService = new CampaignStatsService();

// Only start auto-sync if not in worker mode
if (!process.env.WORKER_MODE) {
  // More frequent sync for high volume campaigns
  const syncInterval = process.env.NODE_ENV === 'production' ? 15000 : 30000; // 15s prod, 30s dev
  
  statsService.syncTimer = setInterval(async () => {
    try {
      await statsService.syncStatsToDatabase();
    } catch (error) {
      console.error('[Stats] Sync timer error:', error);
    }
  }, syncInterval);
  
  console.log(`[Stats] Auto-sync enabled with ${syncInterval/1000}s interval`);
}

// Graceful shutdown handling
process.on('SIGTERM', () => statsService.cleanup());
process.on('SIGINT', () => statsService.cleanup());

export default statsService;