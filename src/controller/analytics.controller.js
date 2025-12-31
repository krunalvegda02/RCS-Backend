import MessageLog from '../models/messageLog.model.js';
import mongoose from 'mongoose';

// Get campaign analytics
export const getCampaignAnalytics = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const { timeframe = 24 } = req.query;

    const analytics = await MessageLog.getCampaignAnalytics(campaignId, parseInt(timeframe));
    
    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch campaign analytics',
      error: error.message
    });
  }
};

// Get user statistics
export const getUserAnalytics = async (req, res) => {
  try {
    const { userId } = req.params;
    const { timeframe = 24 } = req.query;

    const stats = await MessageLog.getUserStats(userId, parseInt(timeframe));
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user analytics',
      error: error.message
    });
  }
};

// Get error analysis
export const getErrorAnalysis = async (req, res) => {
  try {
    const { userId } = req.params;
    const { timeframe = 24 } = req.query;
    
    const timeAgo = new Date(Date.now() - parseInt(timeframe) * 60 * 60 * 1000);
    
    const errorAnalysis = await MessageLog.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          timestamp: { $gte: timeAgo },
          status: 'failed'
        }
      },
      {
        $group: {
          _id: {
            errorCode: '$error.code',
            errorType: '$error.type'
          },
          count: { $sum: 1 },
          messages: { $push: '$error.message' }
        }
      },
      {
        $sort: { count: -1 }
      },
      {
        $limit: 10
      }
    ]);
    
    res.json({
      success: true,
      data: errorAnalysis
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch error analysis',
      error: error.message
    });
  }
};

// Get performance metrics
export const getPerformanceMetrics = async (req, res) => {
  try {
    const { userId } = req.params;
    const { timeframe = 24 } = req.query;
    
    const timeAgo = new Date(Date.now() - parseInt(timeframe) * 60 * 60 * 1000);
    
    const metrics = await MessageLog.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          timestamp: { $gte: timeAgo },
          eventType: 'message_send'
        }
      },
      {
        $group: {
          _id: null,
          avgResponseTime: { $avg: '$responseTimeMs' },
          maxResponseTime: { $max: '$responseTimeMs' },
          minResponseTime: { $min: '$responseTimeMs' },
          totalMessages: { $sum: 1 },
          successfulMessages: {
            $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] }
          }
        }
      },
      {
        $project: {
          _id: 0,
          avgResponseTime: { $round: ['$avgResponseTime', 2] },
          maxResponseTime: 1,
          minResponseTime: 1,
          totalMessages: 1,
          successfulMessages: 1,
          successRate: {
            $round: [
              { $multiply: [{ $divide: ['$successfulMessages', '$totalMessages'] }, 100] },
              2
            ]
          }
        }
      }
    ]);
    
    res.json({
      success: true,
      data: metrics[0] || {
        avgResponseTime: 0,
        maxResponseTime: 0,
        minResponseTime: 0,
        totalMessages: 0,
        successfulMessages: 0,
        successRate: 0
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch performance metrics',
      error: error.message
    });
  }
};