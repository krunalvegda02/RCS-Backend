import mongoose from 'mongoose';
import Campaign from '../models/campaign.model.js';

class CampaignStatsService {
  constructor() {
    this.batchSize = 100;
    this.syncInterval = 30000; // 30 seconds for high volume
  }

  // Alias for BackgroundWorkerService compatibility
  async syncAllCampaignStats() {
    return this.syncStatsToDatabase();
  }

  // No-op - stats write directly to MongoDB
  async syncStatsToDatabase() {
    // Stats are now written directly to MongoDB in incrementStat()
    return;
  }

  // Real-time stats with fallback
  async getCampaignStats(campaignId) {
    try {
      // Validate ObjectId
      if (!this.isValidObjectId(campaignId)) {
        console.warn(`[Stats] Invalid campaignId: ${campaignId}`);
        return null;
      }
      
      const [campaign, messages] = await Promise.all([
        Campaign.findById(campaignId).lean(),
        Message.find({ campaignId }).select('status').lean()
      ]);
      
      if (!campaign) return null;
      
      // Count messages by current status
      const statusCounts = {
        pending: 0,
        queued: 0,
        processing: 0,
        sent: 0,
        delivered: 0,
        read: 0,
        replied: 0,
        failed: 0,
        bounced: 0
      };

      messages.forEach(msg => {
        if (statusCounts.hasOwnProperty(msg.status)) {
          statusCounts[msg.status]++;
        }
      });

      // Calculate cumulative stats (read includes delivered and sent, etc.)
      const realTimeStats = {
        total: campaign.recipients?.length || 0,
        pending: statusCounts.pending,
        queued: statusCounts.queued,
        processing: statusCounts.processing,
        // Sent = all messages that reached sent status or beyond
        sent: statusCounts.sent + statusCounts.delivered + statusCounts.read + statusCounts.replied,
        // Delivered = all messages that reached delivered status or beyond
        delivered: statusCounts.delivered + statusCounts.read + statusCounts.replied,
        // Read = all messages that reached read status or beyond
        read: statusCounts.read + statusCounts.replied,
        // Replied = only messages with replied status
        replied: statusCounts.replied,
        failed: statusCounts.failed,
        bounced: statusCounts.bounced,
        // Interactions = replied messages (user clicked or replied)
        interactions: statusCounts.replied
      };
      
      // Success rate based on delivered vs sent
      realTimeStats.successRate = realTimeStats.sent > 0 ? 
        parseFloat(((realTimeStats.delivered / realTimeStats.sent) * 100).toFixed(2)) : 0;
      
      return realTimeStats;
    } catch (error) {
      console.error('Error getting campaign stats:', error);
      return null;
    }
  }


  // Increment stats atomically - direct MongoDB write
  async incrementStat(campaignId, statType, count = 1) {
    if (!this.isValidObjectId(campaignId)) return;
    
    try {
      const validStatTypes = ['sent', 'delivered', 'read', 'replied', 'failed', 'bounced', 'processing'];
      if (!validStatTypes.includes(statType)) return;
      
      // Direct MongoDB update
      await Campaign.findByIdAndUpdate(campaignId, {
        $inc: { [`stats.${statType}`]: count },
        $set: { 'stats.lastUpdatedAt': new Date() }
      });
      
      if (['sent', 'delivered', 'failed', 'bounced'].includes(statType)) {
        setImmediate(() => this.checkCampaignCompletion(campaignId));
      }
    } catch (error) {
      console.error(`Error incrementing stat ${statType}:`, error);
    }
  }


  // Check if campaign should be marked as completed
  async checkCampaignCompletion(campaignId) {
    try {
      const campaign = await Campaign.findById(campaignId);
      if (!campaign || campaign.status !== 'running') return;
      
      // Get current message counts
      const messageCounts = await Message.aggregate([
        { $match: { campaignId: campaignId } },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]);
      
      const statusCounts = {
        pending: 0,
        queued: 0,
        processing: 0,
        sent: 0,
        delivered: 0,
        read: 0,
        replied: 0,
        failed: 0,
        bounced: 0
      };
      
      messageCounts.forEach(item => {
        if (statusCounts.hasOwnProperty(item._id)) {
          statusCounts[item._id] = item.count;
        }
      });
      
      const totalMessages = Object.values(statusCounts).reduce((sum, count) => sum + count, 0);
      const totalRecipients = campaign.recipients.length;
      const processedMessages = statusCounts.sent + statusCounts.delivered + statusCounts.read + statusCounts.replied + statusCounts.failed + statusCounts.bounced;
      const pendingMessages = statusCounts.pending + statusCounts.queued + statusCounts.processing;
      
      // Check if all messages are processed
      if (totalMessages >= totalRecipients && pendingMessages === 0 && processedMessages >= totalRecipients) {
        console.log(`[Stats] Campaign ${campaignId} ready for completion - Total: ${totalRecipients}, Processed: ${processedMessages}`);
        
        // Update campaign status to completed
        campaign.status = 'completed';
        campaign.completedAt = new Date();
        await campaign.save();
        
        // Emit socket event for real-time update
        if (global.io) {
          global.io.emitCampaignUpdate(campaignId, {
            status: 'completed',
            completedAt: campaign.completedAt,
            stats: {
              total: totalRecipients,
              sent: statusCounts.sent + statusCounts.delivered + statusCounts.read + statusCounts.replied,
              delivered: statusCounts.delivered + statusCounts.read + statusCounts.replied,
              read: statusCounts.read + statusCounts.replied,
              replied: statusCounts.replied,
              failed: statusCounts.failed,
              bounced: statusCounts.bounced
            }
          });
        }
        
        console.log(`[Stats] ✅ Campaign ${campaignId} marked as completed`);
      }
    } catch (error) {
      console.error(`Error checking campaign completion for ${campaignId}:`, error);
    }
  }

  
  // Get message delivery stats for real-time reporting
  async getMessageStats(userId, timeframe = '24h') {
    try {
      // Validate userId
      if (!userId || !this.isValidObjectId(userId)) {
        console.warn(`[Stats] Invalid userId: ${userId}`);
        return {
          totalMessages: 0,
          totalSuccessCount: 0,
          totalFailedCount: 0,
          pendingMessages: 0,
          totalCost: 0
        };
      }

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
      return {
        totalMessages: 0,
        totalSuccessCount: 0,
        totalFailedCount: 0,
        pendingMessages: 0,
        totalCost: 0
      };
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
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  }
}

const statsService = new CampaignStatsService();

// Graceful shutdown handling
process.on('SIGTERM', () => statsService.cleanup());
process.on('SIGINT', () => statsService.cleanup());

export default statsService;