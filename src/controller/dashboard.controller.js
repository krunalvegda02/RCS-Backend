import User from '../models/user.model.js';
import Campaign from '../models/campaign.model.js';
import Template from '../models/template.model.js';
import Message from '../models/message.model.js';

// Get dashboard stats
export const getDashboardStats = async (req, res) => {
  try {
    const { userId } = req.params;

    const [
      totalCampaigns,
      totalTemplates,
      totalMessages,
      successCount,
      failedCount,
      pendingCount
    ] = await Promise.all([
      Campaign.countDocuments({ userId }),
      Template.countDocuments({ userId, isActive: true }),
      Message.countDocuments({ userId }),
      Message.countDocuments({ userId, status: 'delivered' }),
      Message.countDocuments({ userId, status: 'failed' }),
      Message.countDocuments({ userId, status: { $in: ['pending', 'queued'] } })
    ]);

    res.json({
      success: true,
      data: {
        totalCampaigns,
        sendtoteltemplet: totalTemplates,
        totalMessages,
        totalSuccessCount: successCount,
        totalFailedCount: failedCount,
        pendingMessages: pendingCount,
        sentMessages: successCount,
        failedMessages: failedCount
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