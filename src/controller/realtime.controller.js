import Message from '../models/message.model.js';
import MessageLog from '../models/messageLog.model.js';
import Campaign from '../models/campaign.model.js';
import mongoose from 'mongoose';
import statsService from '../services/CampaignStatsService.js';

// Get real-time campaign stats
export const getRealTimeCampaignStats = async (req, res) => {
  try {
    const { campaignId } = req.params;
    
    const stats = await statsService.getCampaignStats(campaignId);
    
    if (!stats) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }
    
    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch real-time stats',
      error: error.message
    });
  }
};

// Get live message feed for a campaign
export const getLiveMessageFeed = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const { limit = 50, offset = 0 } = req.query;
    
    const messages = await Message.find({ campaignId })
      .sort({ updatedAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(offset))
      .select('messageId recipientPhoneNumber status sentAt deliveredAt failedAt errorMessage userClickCount userReplyCount')
      .lean();
    
    res.json({
      success: true,
      data: messages,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch message feed',
      error: error.message
    });
  }
};

// Get recent webhook events
export const getRecentWebhookEvents = async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 20 } = req.query;
    
    const events = await MessageLog.find({
      userId,
      eventType: { $in: ['status_update', 'user_interaction'] }
    })
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .lean();
    
    res.json({
      success: true,
      data: events,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch webhook events',
      error: error.message
    });
  }
};

// Get message status breakdown
export const getMessageStatusBreakdown = async (req, res) => {
  try {
    const { campaignId } = req.params;
    
    const breakdown = await Message.aggregate([
      { $match: { campaignId: new mongoose.Types.ObjectId(campaignId) } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          phoneNumbers: { $push: '$recipientPhoneNumber' }
        }
      },
      { $sort: { count: -1 } }
    ]);
    
    res.json({
      success: true,
      data: breakdown,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch status breakdown',
      error: error.message
    });
  }
};

// Get user interaction summary
export const getUserInteractionSummary = async (req, res) => {
  try {
    const { campaignId } = req.params;
    
    const interactions = await Message.aggregate([
      { 
        $match: { 
          campaignId: new mongoose.Types.ObjectId(campaignId),
          $or: [
            { userClickCount: { $gt: 0 } },
            { userReplyCount: { $gt: 0 } }
          ]
        }
      },
      {
        $group: {
          _id: null,
          totalClicks: { $sum: '$userClickCount' },
          totalReplies: { $sum: '$userReplyCount' },
          uniqueInteractions: { $sum: 1 },
          avgClicksPerMessage: { $avg: '$userClickCount' },
          avgRepliesPerMessage: { $avg: '$userReplyCount' }
        }
      }
    ]);
    
    res.json({
      success: true,
      data: interactions[0] || {
        totalClicks: 0,
        totalReplies: 0,
        uniqueInteractions: 0,
        avgClicksPerMessage: 0,
        avgRepliesPerMessage: 0
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch interaction summary',
      error: error.message
    });
  }
};

// Get user stats
export const getUserStats = async (req, res) => {
  try {
    const { userId } = req.params;
    
    const campaigns = await Campaign.find({ userId }).lean();
    const campaignIds = campaigns.map(c => c._id);
    
    const stats = await Message.aggregate([
      { $match: { campaignId: { $in: campaignIds } } },
      {
        $group: {
          _id: null,
          totalMessages: { $sum: 1 },
          sentMessages: { $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] } },
          deliveredMessages: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
          failedMessages: { $sum: { $cond: [{ $in: ['$status', ['failed', 'bounced']] }, 1, 0] } },
          bouncedMessages: { $sum: { $cond: [{ $eq: ['$status', 'bounced'] }, 1, 0] } },
          readMessages: { $sum: { $cond: [{ $eq: ['$status', 'read'] }, 1, 0] } },
          repliedMessages: { $sum: { $cond: [{ $eq: ['$status', 'replied'] }, 1, 0] } },
          totalClicks: { $sum: '$userClickCount' },
          totalReplies: { $sum: '$userReplyCount' }
        }
      }
    ]);
    
    const result = stats[0] || {
      totalMessages: 0,
      sentMessages: 0,
      deliveredMessages: 0,
      failedMessages: 0,
      bouncedMessages: 0,
      readMessages: 0,
      repliedMessages: 0,
      totalClicks: 0,
      totalReplies: 0
    };
    
    result.totalCampaigns = campaigns.length;
    result.deliveryRate = result.sentMessages > 0 ? (result.deliveredMessages / result.sentMessages * 100).toFixed(2) : 0;
    result.clickRate = result.deliveredMessages > 0 ? (result.totalClicks / result.deliveredMessages * 100).toFixed(2) : 0;
    result.readRate = result.deliveredMessages > 0 ? (result.readMessages / result.deliveredMessages * 100).toFixed(2) : 0;
    result.replyRate = result.deliveredMessages > 0 ? (result.repliedMessages / result.deliveredMessages * 100).toFixed(2) : 0;
    
    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user stats',
      error: error.message
    });
  }
};