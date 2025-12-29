import redis from 'redis';
import Campaign from '../models/campaign.model.js';

const redisClient = redis.createClient({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
});

class CampaignStatsService {
  // Sync Redis stats to database every 5 minutes
  async syncStatsToDatabase() {
    try {
      const keys = await this.getRedisKeys('campaign_stats:*');
      
      for (const key of keys) {
        const campaignId = key.replace('campaign_stats:', '');
        const stats = await redisClient.hgetall(key);
        
        if (Object.keys(stats).length > 0) {
          await Campaign.updateOne(
            { _id: campaignId },
            {
              $inc: {
                'stats.sent': parseInt(stats.delivered || 0),
                'stats.failed': parseInt(stats.failed || 0),
                'stats.processing': parseInt(stats.processing || 0),
              }
            }
          );
          
          // Clear Redis counter after sync
          await redisClient.del(key);
        }
      }
    } catch (error) {
      console.error('Error syncing campaign stats:', error);
    }
  }

  async getRedisKeys(pattern) {
    return new Promise((resolve, reject) => {
      redisClient.keys(pattern, (err, keys) => {
        if (err) reject(err);
        resolve(keys || []);
      });
    });
  }

  // Get real-time stats for frontend
  async getCampaignStats(campaignId) {
    try {
      const campaign = await Campaign.findById(campaignId);
      const redisStats = await redisClient.hgetall(`campaign_stats:${campaignId}`);
      
      return {
        total: campaign.stats.total,
        sent: campaign.stats.sent + parseInt(redisStats.delivered || 0),
        failed: campaign.stats.failed + parseInt(redisStats.failed || 0),
        processing: campaign.stats.processing + parseInt(redisStats.processing || 0),
        pending: campaign.stats.pending - parseInt(redisStats.delivered || 0) - parseInt(redisStats.failed || 0),
      };
    } catch (error) {
      console.error('Error getting campaign stats:', error);
      return null;
    }
  }
}

// Start periodic sync
const statsService = new CampaignStatsService();
setInterval(() => {
  statsService.syncStatsToDatabase();
}, 5 * 60 * 1000); // Every 5 minutes

export default statsService;