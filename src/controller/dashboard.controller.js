import mongoose from 'mongoose';
import User from '../models/user.model.js';
import Campaign from '../models/campaign.model.js';
import Template from '../models/template.model.js';
import ContactCampaignMessage from '../models/contactMessage.model.js';


// Get complete admin dashboard data
export const getAdminDashboard = async (req, res) => {
  try {
    // Get all stats in parallel for better performance
    const [users, recentTransactions, globalStats] = await Promise.all([
      User.find({ role: 'USER' })
        .select('name email phone wallet isActive createdAt companyname')
        .sort({ createdAt: -1 })
        .lean(),

      // Get recent transactions from all users
      User.aggregate([
        { $match: { 'wallet.transactions': { $exists: true, $ne: [] } } },
        { $unwind: '$wallet.transactions' },
        {
          $project: {
            _id: '$wallet.transactions._id',
            type: '$wallet.transactions.type',
            amount: '$wallet.transactions.amount',
            balanceAfter: '$wallet.transactions.balanceAfter',
            description: '$wallet.transactions.description',
            createdAt: '$wallet.transactions.createdAt',
            userId: { _id: '$_id', name: '$name', email: '$email' }
          }
        },
        { $sort: { createdAt: -1 } },
        { $limit: 10 }
      ]).catch(() => []),

      // Get global campaign statistics
      Campaign.aggregate([
        {
          $group: {
            _id: null,
            totalMessages: { $sum: '$stats.delivered' },
            totalCost: { $sum: '$actualCost' }
          }
        }
      ])
    ]);

    // Calculate stats
    const stats = {
      totalUsers: users.length,
      activeUsers: users.filter(u => u.isActive).length,
      totalMessages: globalStats[0]?.totalMessages || 0,
      totalCost: globalStats[0]?.totalCost || 0,
      pendingRequests: 0,
      totalTransactions: recentTransactions.length,
      totalWalletBalance: users.reduce((sum, u) => sum + (u.wallet?.balance || 0), 0)
    };

    // Get recent users (last 10)
    const recentUsers = users.slice(0, 10).map(user => {
      // Extract date from MongoDB ObjectId if createdAt is missing
      const createdDate = user.createdAt || new Date(parseInt(user._id.toString().substring(0, 8), 16) * 1000);

      return {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        companyname: user.companyname,
        isActive: user.isActive,
        status: user.isActive ? 'active' : 'inactive',
        Wallet: user.wallet?.balance || 0,
        createdAt: createdDate
      };
    });

    res.json({
      success: true,
      dashboard: {
        stats,
        recentUsers,
        recentWalletRequests: [],
        recentTransactions
      }
    });
  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch admin dashboard data',
      error: error.message
    });
  }
};

// Get user dashboard stats
export const getUserDashboardStats = async (req, res) => {
  try {
    const { userId } = req.params;

    const [campaignsCount, templatesCount, campaignAggStats] = await Promise.all([
      Campaign.countDocuments({ userId }),
      Template.countDocuments({ userId, isActive: true }),
      // OPTIMIZATION: Use Campaign aggregation instead of scanning millions of messages
      Campaign.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(userId) } },
        {
          $group: {
            _id: null,
            totalMessages: { $sum: '$stats.total' },
            totalSent: { $sum: '$stats.sent' },
            totalDelivered: { $sum: '$stats.delivered' },
            totalRead: { $sum: '$stats.read' },
            totalReplied: { $sum: '$stats.replied' },
            totalFailed: { $sum: '$stats.failed' },
            totalCost: { $sum: '$actualCost' }
          }
        }
      ])
    ]);

    const stats = campaignAggStats[0] || {
      totalMessages: 0,
      totalSent: 0,
      totalDelivered: 0,
      totalRead: 0,
      totalReplied: 0,
      totalFailed: 0,
      totalCost: 0
    };

    // stats.totalDelivered already includes delivered, read, and replied
    const actualDelivered = stats.totalDelivered || 0;

    res.json({
      success: true,
      data: {
        totalCampaigns: campaignsCount,
        sendtoteltemplet: templatesCount,
        totalMessages: stats.totalMessages,
        totalSuccessCount: actualDelivered,
        totalDelivered: actualDelivered,
        totalFailedCount: stats.totalFailed,
        totalCost: stats.totalCost
      }
    });
  } catch (error) {
    console.error('[Dashboard] Error fetching user stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard stats',
      error: error.message
    });
  }
};

// Get user recent campaigns
export const getUserRecentCampaigns = async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit) || 10;

    // OPTIMIZATION: Use cached stats field in Campaign model directly
    // This eliminates the need to aggregate millions of ContactCampaignMessage documents on every page load
    const campaigns = await Campaign.find({ userId })
      .populate('templateId', 'name templateType')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    // Transform campaigns with cached stats
    const transformedCampaigns = campaigns.map(campaign => {
      const stats = campaign.stats || { total: 0, sent: 0, delivered: 0, read: 0, replied: 0, failed: 0 };
      // stats.delivered already includes delivered, read, and replied
      const actualDelivered = stats.delivered || 0;
      return {
        _id: campaign._id,
        CampaignName: campaign.name,
        type: campaign.templateId?.templateType || 'plainText',
        cost: stats.total,
        successCount: stats.sent,
        failedCount: stats.failed,
        totalDelivered: actualDelivered,
        status: campaign.status,
        createdAt: campaign.createdAt
      };
    });

    res.json({
      success: true,
      data: transformedCampaigns
    });
  } catch (error) {
    console.error('[Dashboard] Error fetching recent campaigns:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch recent campaigns',
      error: error.message
    });
  }
};

// Get admin summary for reports
export const getAdminSummary = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    // Default to last 30 days if no dates provided
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // OPTIMIZATION: Use Campaign aggregate instead of Message (which doesn't exist)
    const [users, campaignAgg, campaigns, transactions] = await Promise.all([
      User.find({ role: 'USER', createdAt: { $gte: start, $lte: end } }).lean(),
      Campaign.aggregate([
        { $match: { createdAt: { $gte: start, $lte: end } } },
        {
          $group: {
            _id: null,
            totalMessages: { $sum: '$stats.total' },
            totalCost: { $sum: '$actualCost' },
            deliveredCount: { $sum: '$stats.delivered' }
          }
        }
      ]),
      Campaign.find({ createdAt: { $gte: start, $lte: end } }).lean(),
      User.aggregate([
        { $match: { 'wallet.transactions.createdAt': { $gte: start, $lte: end } } },
        { $unwind: '$wallet.transactions' },
        { $match: { 'wallet.transactions.createdAt': { $gte: start, $lte: end } } },
        {
          $group: {
            _id: null,
            totalAmount: { $sum: '$wallet.transactions.amount' },
            totalTransactions: { $sum: 1 }
          }
        }
      ])
    ]);

    const globalStats = campaignAgg[0] || { totalMessages: 0, totalCost: 0, deliveredCount: 0 };
    const transactionStats = transactions[0] || { totalAmount: 0, totalTransactions: 0 };

    const summary = {
      totalAmount: transactionStats.totalAmount,
      totalGrowth: '12.5%', // Calculate based on previous period placeholder
      totalMessageCost: globalStats.totalMessages,
      messageGrowthCount: '8.3%',
      messageGrowthDirection: 'this month',
      activeUsers: users.filter(u => u.isActive).length,
      activeUserGrowth: '5.2%',
      successRate: globalStats.totalMessages > 0
        ? `${((globalStats.deliveredCount / globalStats.totalMessages) * 100).toFixed(1)}%`
        : '0%'
    };

    res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    console.error('Admin summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch admin summary',
      error: error.message
    });
  }
};

// Get monthly analytics
export const getMonthlyAnalytics = async (req, res) => {
  try {
    const { userId } = req.params;
    const { months = 6 } = req.query;

    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    // Get monthly message data from Campaigns
    const campaignData = await Campaign.aggregate([
      { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          revenue: { $sum: '$actualCost' },
          count: { $sum: '$stats.total' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    // Get monthly transaction data
    const transactionData = await User.aggregate([
      { $unwind: '$wallet.transactions' },
      { $match: { 'wallet.transactions.createdAt': { $gte: startDate, $lte: endDate } } },
      {
        $group: {
          _id: {
            year: { $year: '$wallet.transactions.createdAt' },
            month: { $month: '$wallet.transactions.createdAt' }
          },
          revenue: { $sum: '$wallet.transactions.amount' },
          users: { $addToSet: '$_id' }
        }
      },
      {
        $project: {
          _id: 1,
          revenue: 1,
          users: { $size: '$users' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    // Format data for charts
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const formattedMessageData = campaignData.map(item => ({
      month: monthNames[item._id.month - 1],
      revenue: item.revenue,
      count: item.count
    }));

    const formattedTransactionData = transactionData.map(item => ({
      month: monthNames[item._id.month - 1],
      revenue: item.revenue,
      users: item.users
    }));

    res.json({
      success: true,
      data: {
        messageData: formattedMessageData,
        transactionData: formattedTransactionData
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch monthly analytics',
      error: error.message
    });
  }
};

// Get weekly analytics
export const getWeeklyAnalytics = async (req, res) => {
  try {
    const { userId } = req.params;

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);

    const weeklyData = await Campaign.aggregate([
      { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' }
          },
          count: { $sum: '$stats.total' },
          cost: { $sum: '$actualCost' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]);

    // Format data for chart
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const formattedData = weeklyData.map(item => {
      const date = new Date(item._id.year, item._id.month - 1, item._id.day);
      return {
        day: dayNames[date.getDay()],
        count: item.count,
        cost: item.cost
      };
    });

    res.json({
      success: true,
      data: formattedData
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch weekly analytics',
      error: error.message
    });
  }
};

// Add wallet money request (deprecated - use Razorpay payment instead)
export const addWalletRequest = async (req, res) => {
  res.status(410).json({
    success: false,
    message: 'Wallet requests are no longer supported. Please use Razorpay payment gateway for wallet recharge.'
  });
};

// Get monthly campaign statistics
export const getMonthlyStats = async (req, res) => {
  try {
    const { monthsBack = 1 } = req.query;
    const ArchivedCampaign = mongoose.model('ArchivedCampaign');

    const now = new Date();
    const targetDate = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
    const startDate = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);
    const endDate = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0, 23, 59, 59, 999);

    // Active campaigns
    const [activeCampaigns, archivedCampaigns, topUsers, statusBreakdown] = await Promise.all([
      Campaign.aggregate([
        { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
        {
          $group: {
            _id: null,
            totalCampaigns: { $sum: 1 },
            totalMessages: { $sum: '$stats.total' },
            totalSent: { $sum: '$stats.sent' },
            totalDelivered: { $sum: '$stats.delivered' },
            totalRead: { $sum: '$stats.read' },
            totalReplied: { $sum: '$stats.replied' },
            totalFailed: { $sum: '$stats.failed' },
            totalExpired: { $sum: '$stats.expired' },
            totalCost: { $sum: '$actualCost' },
            totalRefunded: { $sum: '$refundedAmount' }
          }
        }
      ]),

      // Archived campaigns
      ArchivedCampaign.aggregate([
        { $match: { campaignCreatedAt: { $gte: startDate, $lte: endDate } } },
        {
          $group: {
            _id: null,
            totalCampaigns: { $sum: 1 },
            totalMessages: { $sum: '$stats.total' },
            totalSent: { $sum: '$stats.sent' },
            totalDelivered: { $sum: '$stats.delivered' },
            totalRead: { $sum: '$stats.read' },
            totalFailed: { $sum: '$stats.failed' },
            totalExpired: { $sum: '$stats.expired' },
            totalCost: { $sum: '$actualCost' },
            totalRefunded: { $sum: '$refundedAmount' }
          }
        }
      ]),

      // Top users by campaigns
      Campaign.aggregate([
        { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
        { $group: { _id: '$userId', count: { $sum: 1 }, totalMessages: { $sum: '$stats.total' }, totalCost: { $sum: '$actualCost' } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
        { $unwind: '$user' },
        { $project: { name: '$user.name', email: '$user.email', campaigns: '$count', messages: '$totalMessages', cost: '$totalCost' } }
      ]),

      // Campaign status breakdown
      Campaign.aggregate([
        { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ])
    ]);

    const active = activeCampaigns[0] || { totalCampaigns: 0, totalMessages: 0, totalSent: 0, totalDelivered: 0, totalRead: 0, totalReplied: 0, totalFailed: 0, totalExpired: 0, totalCost: 0, totalRefunded: 0 };
    const archived = archivedCampaigns[0] || { totalCampaigns: 0, totalMessages: 0, totalSent: 0, totalDelivered: 0, totalRead: 0, totalFailed: 0, totalExpired: 0, totalCost: 0, totalRefunded: 0 };

    const combined = {
      totalCampaigns: active.totalCampaigns + archived.totalCampaigns,
      activeCampaigns: active.totalCampaigns,
      archivedCampaigns: archived.totalCampaigns,
      totalMessages: active.totalMessages + archived.totalMessages,
      totalSent: active.totalSent + archived.totalSent,
      totalDelivered: active.totalDelivered + archived.totalDelivered,
      totalRead: active.totalRead + archived.totalRead,
      totalReplied: active.totalReplied || 0,
      totalFailed: active.totalFailed + archived.totalFailed,
      totalExpired: active.totalExpired + archived.totalExpired,
      totalCost: active.totalCost + archived.totalCost,
      totalRefunded: active.totalRefunded + archived.totalRefunded,
      netRevenue: (active.totalCost + archived.totalCost) - (active.totalRefunded + archived.totalRefunded),
      deliveryRate: active.totalMessages + archived.totalMessages > 0 ? ((active.totalDelivered + archived.totalDelivered) / (active.totalMessages + archived.totalMessages) * 100).toFixed(2) : 0,
      readRate: active.totalMessages + archived.totalMessages > 0 ? ((active.totalRead + archived.totalRead) / (active.totalMessages + archived.totalMessages) * 100).toFixed(2) : 0,
      failureRate: active.totalMessages + archived.totalMessages > 0 ? ((active.totalFailed + archived.totalFailed) / (active.totalMessages + archived.totalMessages) * 100).toFixed(2) : 0
    };

    res.json({
      success: true,
      data: {
        period: {
          start: startDate,
          end: endDate,
          monthName: startDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
        },
        stats: combined,
        topUsers,
        statusBreakdown
      }
    });
  } catch (error) {
    console.error('Monthly stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch monthly stats',
      error: error.message
    });
  }
};