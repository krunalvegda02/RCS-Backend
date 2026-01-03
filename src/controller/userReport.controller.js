import User from '../models/user.model.js';
import Campaign from '../models/campaign.model.js';
import Message from '../models/message.model.js';

export const getUserReport = async (req, res) => {
  try {
    const { userId } = req.params;
    const { campaignPage = 1, transactionPage = 1, campaignLimit = 5, transactionLimit = 5 } = req.query;

    const user = await User.findById(userId).select('+jioConfig.clientSecret');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Get campaigns with pagination
    const campaignsQuery = Campaign.find({ userId })
      .populate('templateId', 'name templateType')
      .sort({ createdAt: -1 });
    
    const totalCampaigns = await Campaign.countDocuments({ userId });
    const campaigns = await campaignsQuery
      .limit(parseInt(campaignLimit))
      .skip((parseInt(campaignPage) - 1) * parseInt(campaignLimit))
      .lean();

    // Get message statistics for each campaign
    const campaignIds = campaigns.map(c => c._id);
    const campaignMessageStats = await Message.aggregate([
      { $match: { campaignId: { $in: campaignIds } } },
      {
        $group: {
          _id: '$campaignId',
          read: { $sum: { $cond: [{ $eq: ['$status', 'read'] }, 1, 0] } },
          replied: { $sum: { $cond: [{ $eq: ['$status', 'replied'] }, 1, 0] } },
        }
      }
    ]);

    const statsMap = {};
    campaignMessageStats.forEach(stat => {
      statsMap[stat._id.toString()] = { read: stat.read, replied: stat.replied };
    });

    // Get overall message statistics
    const messageStats = await Message.aggregate([
      { $match: { userId: user._id } },
      {
        $group: {
          _id: null,
          totalSent: { $sum: 1 },
          delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $in: ['$status', ['failed', 'bounced']] }, 1, 0] } },
          read: { $sum: { $cond: [{ $eq: ['$status', 'read'] }, 1, 0] } },
          replied: { $sum: { $cond: [{ $eq: ['$status', 'replied'] }, 1, 0] } },
          totalInteractions: { $sum: '$userClickCount' },
          totalReplies: { $sum: '$userReplyCount' }
        }
      }
    ]);

    const stats = messageStats[0] || {
      totalSent: 0,
      delivered: 0,
      failed: 0,
      read: 0,
      replied: 0,
      totalInteractions: 0,
      totalReplies: 0
    };

    // Campaign statistics
    const allCampaigns = await Campaign.find({ userId }).lean();
    const campaignStats = {
      total: allCampaigns.length,
      completed: allCampaigns.filter(c => c.status === 'completed').length,
      running: allCampaigns.filter(c => c.status === 'running').length,
      failed: allCampaigns.filter(c => c.status === 'failed').length,
      totalRecipients: allCampaigns.reduce((sum, c) => sum + (c.stats?.total || 0), 0),
      totalCost: allCampaigns.reduce((sum, c) => sum + (c.actualCost || 0), 0)
    };

    // Format campaigns with stats
    const formattedCampaigns = campaigns.map(c => {
      const campaignStats = statsMap[c._id.toString()] || { read: 0, replied: 0 };
      return {
        _id: c._id,
        name: c.name,
        type: c.templateId?.templateType,
        status: c.status,
        recipients: c.stats?.total || 0,
        sent: c.stats?.sent || 0,
        delivered: c.stats?.delivered || 0,
        failed: c.stats?.failed || 0,
        read: campaignStats.read,
        replied: campaignStats.replied,
        createdAt: c.createdAt
      };
    });

    // Wallet transactions with pagination
    const totalTransactions = user.wallet.transactions?.length || 0;
    const startIdx = (parseInt(transactionPage) - 1) * parseInt(transactionLimit);
    const endIdx = startIdx + parseInt(transactionLimit);
    const paginatedTransactions = (user.wallet.transactions || [])
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(startIdx, endIdx);

    // Wallet info
    const walletInfo = {
      balance: user.wallet.balance,
      blockedBalance: user.wallet.blockedBalance || 0,
      availableBalance: user.getAvailableBalance(),
      currency: user.wallet.currency,
      totalTransactions,
      transactions: paginatedTransactions,
      transactionPagination: {
        page: parseInt(transactionPage),
        limit: parseInt(transactionLimit),
        total: totalTransactions,
        pages: Math.ceil(totalTransactions / parseInt(transactionLimit))
      }
    };

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
        wallet: walletInfo,
        messageStats: stats,
        campaignStats,
        campaigns: formattedCampaigns,
        campaignPagination: {
          page: parseInt(campaignPage),
          limit: parseInt(campaignLimit),
          total: totalCampaigns,
          pages: Math.ceil(totalCampaigns / parseInt(campaignLimit))
        },
        userStats: user.stats
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
