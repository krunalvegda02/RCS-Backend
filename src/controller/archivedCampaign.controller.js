import ArchivedCampaign from '../models/archivedCampaign.model.js';

// Get users with archived campaigns count
export const getUsersWithArchives = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Build match stage for date filtering based on campaign creation date
    const matchStage = {};
    if (startDate || endDate) {
      matchStage.campaignCreatedAt = {};
      if (startDate) matchStage.campaignCreatedAt.$gte = new Date(startDate);
      if (endDate) matchStage.campaignCreatedAt.$lte = new Date(endDate);
    }

    const pipeline = [];
    
    // Add match stage if we have date filters
    if (Object.keys(matchStage).length > 0) {
      pipeline.push({ $match: matchStage });
    }
    
    // Add grouping and sorting
    pipeline.push(
      {
        $group: {
          _id: '$userId',
          userName: { $first: '$userName' },
          userEmail: { $first: '$userEmail' },
          totalArchived: { $sum: 1 },
          lastArchived: { $max: '$archivedAt' },
          lastCampaignCreated: { $max: '$campaignCreatedAt' }
        }
      },
      { $sort: { lastCampaignCreated: -1 } }
    );

    const users = await ArchivedCampaign.aggregate(pipeline);

    res.json({ success: true, data: users });
  } catch (error) {
    console.error('Get users with archives error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get all archived campaigns (Admin only)
export const getArchivedCampaigns = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, userId, startDate, endDate } = req.query;

    const query = {};
    
    if (userId) query.userId = userId;
    if (search) {
      query.$or = [
        { campaignName: { $regex: search, $options: 'i' } },
        { campaignId: { $regex: search, $options: 'i' } },
        { userName: { $regex: search, $options: 'i' } }
      ];
    }
    
    // Add date filtering based on campaign creation date
    if (startDate || endDate) {
      query.campaignCreatedAt = {};
      if (startDate) query.campaignCreatedAt.$gte = new Date(startDate);
      if (endDate) query.campaignCreatedAt.$lte = new Date(endDate);
    }

    const archives = await ArchivedCampaign.find(query)
      .sort({ campaignCreatedAt: -1 }) // Sort by campaign creation date instead of archived date
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const total = await ArchivedCampaign.countDocuments(query);

    res.json({
      success: true,
      data: archives,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get archived campaigns error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get single archived campaign
export const getArchivedCampaign = async (req, res) => {
  try {
    const { id } = req.params;

    const archive = await ArchivedCampaign.findById(id).lean();
    
    if (!archive) {
      return res.status(404).json({ success: false, message: 'Archived campaign not found' });
    }

    res.json({ success: true, data: archive });
  } catch (error) {
    console.error('Get archived campaign error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get archived campaigns stats with date filtering
export const getArchivedStats = async (req, res) => {
  try {
    const { startDate, endDate, userId } = req.query;

    const query = {};
    
    if (userId) query.userId = userId;
    
    // Filter based on campaign creation date instead of archived date
    if (startDate || endDate) {
      query.campaignCreatedAt = {};
      if (startDate) query.campaignCreatedAt.$gte = new Date(startDate);
      if (endDate) query.campaignCreatedAt.$lte = new Date(endDate);
    }

    const stats = await ArchivedCampaign.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalCampaigns: { $sum: 1 },
          totalMessages: { $sum: '$stats.total' },
          totalSent: { $sum: '$stats.sent' },
          totalDelivered: { $sum: '$stats.delivered' },
          totalFailed: { $sum: '$stats.failed' },
          totalPending: { $sum: '$stats.pending' },
          totalExpired: { $sum: '$stats.expired' },
          uniqueUsers: { $addToSet: '$userId' }
        }
      },
      {
        $project: {
          _id: 0,
          totalCampaigns: 1,
          totalMessages: 1,
          totalSent: 1,
          totalDelivered: 1,
          totalFailed: 1,
          totalPending: 1,
          totalExpired: 1,
          uniqueUsers: { $size: '$uniqueUsers' },
          deliveryRate: {
            $cond: {
              if: { $eq: ['$totalSent', 0] },
              then: 0,
              else: { $multiply: [{ $divide: ['$totalDelivered', '$totalSent'] }, 100] }
            }
          },
          sentRate: {
            $cond: {
              if: { $eq: ['$totalMessages', 0] },
              then: 0,
              else: { $multiply: [{ $divide: ['$totalSent', '$totalMessages'] }, 100] }
            }
          }
        }
      }
    ]);

    const result = stats[0] || {
      totalCampaigns: 0,
      totalMessages: 0,
      totalSent: 0,
      totalDelivered: 0,
      totalFailed: 0,
      totalPending: 0,
      totalExpired: 0,
      uniqueUsers: 0,
      deliveryRate: 0,
      sentRate: 0
    };

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Get archived stats error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Delete archived campaign record (Admin only)
export const deleteArchivedCampaign = async (req, res) => {
  try {
    const { id } = req.params;

    const archive = await ArchivedCampaign.findByIdAndDelete(id);
    
    if (!archive) {
      return res.status(404).json({ success: false, message: 'Archived campaign not found' });
    }

    res.json({ success: true, message: 'Archived campaign record deleted' });
  } catch (error) {
    console.error('Delete archived campaign error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
