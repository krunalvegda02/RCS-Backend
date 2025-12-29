import Campaign from '../models/campaign.model.js';
import Message from '../models/message.model.js';
import statsService from '../services/CampaignStatsService.js';

// Get campaign reports with pagination for large datasets
export const getCampaignReports = async (req, res) => {
  try {
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100); // Max 100 per page
    const skip = (page - 1) * limit;

    // Use aggregation for better performance
    const campaigns = await Campaign.aggregate([
      { $match: { userId } },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: 'templates',
          localField: 'templateId',
          foreignField: '_id',
          as: 'template'
        }
      },
      { $unwind: '$template' },
      {
        $project: {
          name: 1,
          status: 1,
          stats: 1,
          createdAt: 1,
          completedAt: 1,
          'template.name': 1,
          'template.messageType': 1,
          estimatedCost: 1,
          actualCost: 1
        }
      }
    ]);

    // Get real-time stats for active campaigns
    for (const campaign of campaigns) {
      if (campaign.status === 'running') {
        const realTimeStats = await statsService.getCampaignStats(campaign._id);
        if (realTimeStats) {
          campaign.stats = realTimeStats;
        }
      }
    }

    const total = await Campaign.countDocuments({ userId });

    res.json({
      success: true,
      data: campaigns,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get campaign details with message pagination
export const getCampaignDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const status = req.query.status;

    const campaign = await Campaign.findOne({ _id: id, userId })
      .populate('templateId', 'name messageType');

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found',
      });
    }

    // Get real-time stats
    const realTimeStats = await statsService.getCampaignStats(id);
    if (realTimeStats) {
      campaign.stats = realTimeStats;
    }

    // Get messages with pagination and filtering
    let messageQuery = { campaignId: id };
    if (status) messageQuery.status = status;

    const messages = await Message.find(messageQuery)
      .select('recipientPhoneNumber status deliveredAt failedAt errorMessage cost')
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip((page - 1) * limit);

    const messageTotal = await Message.countDocuments(messageQuery);

    res.json({
      success: true,
      data: {
        campaign,
        messages,
        pagination: {
          page,
          limit,
          total: messageTotal,
          pages: Math.ceil(messageTotal / limit),
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get campaign summary stats (optimized for large campaigns)
export const getCampaignSummary = async (req, res) => {
  try {
    const userId = req.user._id;

    // Use aggregation for performance
    const summary = await Campaign.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: null,
          totalCampaigns: { $sum: 1 },
          totalMessages: { $sum: '$stats.total' },
          totalSent: { $sum: '$stats.sent' },
          totalFailed: { $sum: '$stats.failed' },
          totalCost: { $sum: '$actualCost' },
          activeCampaigns: {
            $sum: { $cond: [{ $eq: ['$status', 'running'] }, 1, 0] }
          },
        }
      }
    ]);

    res.json({
      success: true,
      data: summary[0] || {
        totalCampaigns: 0,
        totalMessages: 0,
        totalSent: 0,
        totalFailed: 0,
        totalCost: 0,
        activeCampaigns: 0,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};