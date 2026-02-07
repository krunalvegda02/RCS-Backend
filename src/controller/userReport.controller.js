import User from '../models/user.model.js';
import Campaign from '../models/campaign.model.js';
import ContactCampaignMessage from '../models/contactMessage.model.js';
import mongoose from 'mongoose';

export const getUserReport = async (req, res) => {
  try {
    const { userId } = req.params;
    const { campaignPage = 1, transactionPage = 1, campaignLimit = 5, transactionLimit = 5 } = req.query;

    // Parallel execution for better performance
    const [
      user,
      totalCampaigns,
      campaigns,
      campaignStatsAgg
    ] = await Promise.all([
      // Get user with minimal fields (exclude heavy transactions array)
      User.findById(userId)
        .select('name email phone companyname role isActive isVerified createdAt lastLogin wallet.balance wallet.blockedBalance wallet.currency jioConfig stats')
        .lean(),

      // Count total campaigns
      Campaign.countDocuments({ userId }),

      // Get paginated campaigns with minimal fields
      Campaign.find({ userId })
        .select('name status stats actualCost createdAt templateId rcsCapableCount')
        .populate('templateId', 'templateType')
        .sort({ createdAt: -1 })
        .limit(parseInt(campaignLimit))
        .skip((parseInt(campaignPage) - 1) * parseInt(campaignLimit))
        .lean(),

      // Get campaign statistics using aggregation (faster than fetching all campaigns)
      Campaign.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(userId) } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            completed: { $sum: { $cond: [{ $in: ['$status', ['completed', 'settled']] }, 1, 0] } },
            running: { $sum: { $cond: [{ $in: ['$status', ['running', 'processing', 'pending']] }, 1, 0] } },
            failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
            totalRecipients: { $sum: '$stats.total' },
            totalCost: { $sum: '$actualCost' },
            totalSent: { $sum: '$stats.sent' },
            totalDelivered: { $sum: '$stats.delivered' },
            totalFailed: { $sum: '$stats.failed' },
            totalRead: { $sum: '$stats.read' },
            totalReplied: { $sum: '$stats.replied' }
          }
        }
      ])
    ]);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const campaignStats = campaignStatsAgg[0] || {
      total: 0,
      completed: 0,
      running: 0,
      failed: 0,
      totalRecipients: 0,
      totalCost: 0,
      totalSent: 0,
      totalDelivered: 0,
      totalFailed: 0,
      totalRead: 0,
      totalReplied: 0
    };

    // Use aggregated stats from campaigns instead of querying ContactCampaignMessage
    const messageStats = {
      totalSent: campaignStats.totalSent,
      delivered: campaignStats.totalDelivered,
      failed: campaignStats.totalFailed,
      read: campaignStats.totalRead,
      replied: campaignStats.totalReplied,
      totalInteractions: 0,
      totalReplies: 0
    };

    // Format campaigns
    const formattedCampaigns = campaigns.map(c => ({
      _id: c._id,
      name: c.name,
      type: c.templateId?.templateType || 'RCS',
      status: c.status,
      recipients: c.stats?.total || 0,
      rcsCapable: c.rcsCapableCount || 0,
      sent: c.stats?.sent || 0,
      delivered: c.stats?.delivered || 0,
      failed: c.stats?.failed || 0,
      read: c.stats?.read || 0,
      replied: c.stats?.replied || 0,
      createdAt: c.createdAt
    }));

    // Get transactions separately and paginated from User collection
    const userWithTransactions = await User.findById(userId)
      .select('wallet.transactions')
      .lean();

    const allTransactions = userWithTransactions?.wallet?.transactions || [];
    const totalTransactions = allTransactions.length;
    const startIdx = (parseInt(transactionPage) - 1) * parseInt(transactionLimit);
    const endIdx = startIdx + parseInt(transactionLimit);
    const paginatedTransactions = allTransactions
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(startIdx, endIdx);

    // Calculate available balance
    const availableBalance = (user.wallet?.balance || 0);

    res.json({
      success: true,
      data: {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          companyname: user.companyname,
          role: user.role,
          isActive: user.isActive,
          isVerified: user.isVerified,
          createdAt: user.createdAt,
          lastLogin: user.lastLogin,
          jioConfig: {
            isConfigured: user.jioConfig?.isConfigured || false,
            clientId: user.jioConfig?.clientId || '',
            assistantId: user.jioConfig?.assistantId || ''
          }
        },
        wallet: {
          balance: user.wallet?.balance || 0,
          blockedBalance: user.wallet?.blockedBalance || 0,
          availableBalance,
          currency: user.wallet?.currency || 'INR',
          totalTransactions,
          transactions: paginatedTransactions,
          transactionPagination: {
            page: parseInt(transactionPage),
            limit: parseInt(transactionLimit),
            total: totalTransactions,
            pages: Math.ceil(totalTransactions / parseInt(transactionLimit))
          }
        },
        messageStats,
        campaignStats,
        campaigns: formattedCampaigns,
        campaignPagination: {
          page: parseInt(campaignPage),
          limit: parseInt(campaignLimit),
          total: totalCampaigns,
          pages: Math.ceil(totalCampaigns / parseInt(campaignLimit))
        },
        userStats: user.stats || {}
      }
    });
  } catch (error) {
    console.error('Get user report error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};


export const getMyReport = async (req, res) => {
  try {
    const userId = req.user._id;
    const { campaignPage = 1, transactionPage = 1, campaignLimit = 5, transactionLimit = 5 } = req.query;

    const [
      user,
      totalCampaigns,
      campaigns,
      campaignStatsAgg
    ] = await Promise.all([
      User.findById(userId)
        .select('name email phone companyname role isActive isVerified createdAt lastLogin wallet.balance wallet.blockedBalance wallet.currency jioConfig stats')
        .lean(),

      Campaign.countDocuments({ userId }),

      Campaign.find({ userId })
        .select('name status stats actualCost createdAt templateId rcsCapableCount')
        .populate('templateId', 'templateType')
        .sort({ createdAt: -1 })
        .limit(parseInt(campaignLimit))
        .skip((parseInt(campaignPage) - 1) * parseInt(campaignLimit))
        .lean(),

      Campaign.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(userId) } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            completed: { $sum: { $cond: [{ $in: ['$status', ['completed', 'settled']] }, 1, 0] } },
            running: { $sum: { $cond: [{ $in: ['$status', ['running', 'processing', 'pending']] }, 1, 0] } },
            failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
            totalRecipients: { $sum: '$stats.total' },
            totalCost: { $sum: '$actualCost' },
            totalSent: { $sum: '$stats.sent' },
            totalDelivered: { $sum: '$stats.delivered' },
            totalFailed: { $sum: '$stats.failed' },
            totalRead: { $sum: '$stats.read' },
            totalReplied: { $sum: '$stats.replied' }
          }
        }
      ])
    ]);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const campaignStats = campaignStatsAgg[0] || {
      total: 0, completed: 0, running: 0, failed: 0,
      totalRecipients: 0, totalCost: 0, totalSent: 0,
      totalDelivered: 0, totalFailed: 0, totalRead: 0, totalReplied: 0
    };

    const formattedCampaigns = campaigns.map(c => ({
      _id: c._id,
      name: c.name,
      type: c.templateId?.templateType || 'N/A',
      status: c.status,
      recipients: c.stats?.total || 0,
      rcsCapable: c.rcsCapableCount || 0,
      sent: c.stats?.sent || 0,
      delivered: c.stats?.delivered || 0,
      read: c.stats?.read || 0,
      replied: c.stats?.replied || 0,
      failed: c.stats?.failed || 0,
      createdAt: c.createdAt
    }));

    const fullUser = await User.findById(userId).select('wallet').lean();
    const transactions = fullUser?.wallet?.transactions || [];
    const paginatedTransactions = transactions
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice((parseInt(transactionPage) - 1) * parseInt(transactionLimit), parseInt(transactionPage) * parseInt(transactionLimit));

    res.status(200).json({
      success: true,
      data: {
        user,
        wallet: {
          balance: user.wallet?.balance || 0,
          blockedBalance: user.wallet?.blockedBalance || 0,
          availableBalance: (user.wallet?.balance || 0),
          currency: user.wallet?.currency || 'INR',
          totalTransactions: transactions.length,
          transactions: paginatedTransactions,
          transactionPagination: {
            total: transactions.length,
            page: parseInt(transactionPage),
            limit: parseInt(transactionLimit),
            totalPages: Math.ceil(transactions.length / parseInt(transactionLimit))
          }
        },
        messageStats: {
          totalSent: campaignStats.totalSent,
          delivered: campaignStats.totalDelivered,
          failed: campaignStats.totalFailed,
          read: campaignStats.totalRead,
          replied: campaignStats.totalReplied,
          totalInteractions: user.stats?.totalInteractions || 0,
          totalReplies: user.stats?.totalReplies || 0
        },
        campaignStats: {
          total: campaignStats.total,
          completed: campaignStats.completed,
          running: campaignStats.running,
          failed: campaignStats.failed,
          totalRecipients: campaignStats.totalRecipients,
          totalCost: campaignStats.totalCost
        },
        campaigns: formattedCampaigns,
        campaignPagination: {
          total: totalCampaigns,
          page: parseInt(campaignPage),
          limit: parseInt(campaignLimit),
          totalPages: Math.ceil(totalCampaigns / parseInt(campaignLimit))
        },
        userStats: user.stats || {}
      }
    });
  } catch (error) {
    console.error('Get my report error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};
