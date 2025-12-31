import User from '../models/user.model.js';
import Campaign from '../models/campaign.model.js';
import Template from '../models/template.model.js';
import Message from '../models/message.model.js';
import MessageLog from '../models/messageLog.model.js';
import statsService from '../services/CampaignStatsService.js';

// Get dashboard stats with real-time data
export const getDashboardStats = async (req, res) => {
  try {
    const { userId } = req.params;

    // Use optimized stats service for real-time data
    const messageStats = await statsService.getMessageStats(userId, '24h');
    
    const [
      totalCampaigns,
      totalTemplates
    ] = await Promise.all([
      Campaign.countDocuments({ userId }),
      Template.countDocuments({ userId, isActive: true })
    ]);

    res.json({
      success: true,
      data: {
        totalCampaigns,
        totalTemplates,
        totalMessages: messageStats?.totalMessages || 0,
        totalSuccessCount: messageStats?.totalSuccessCount || 0,
        totalFailedCount: messageStats?.totalFailedCount || 0,
        pendingMessages: messageStats?.pendingMessages || 0,
        sentMessages: messageStats?.totalSuccessCount || 0,
        failedMessages: messageStats?.totalFailedCount || 0,
        deliveredMessages: messageStats?.totalSuccessCount || 0,
        totalCost: messageStats?.totalCost || 0
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard stats',
      error: error.message
    });
  }
};

// Get recent orders/campaigns
export const getRecentOrders = async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit) || 10;

    const orders = await Campaign.find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json({
      success: true,
      data: orders
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch recent orders',
      error: error.message
    });
  }
};

// Add wallet money request
export const addWalletRequest = async (req, res) => {
  try {
    const { amount, userId } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid amount'
      });
    }

    // Create wallet request (you can create a WalletRequest model)
    // For now, just return success
    res.json({
      success: true,
      message: 'Wallet recharge request submitted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to submit wallet request',
      error: error.message
    });
  }
};