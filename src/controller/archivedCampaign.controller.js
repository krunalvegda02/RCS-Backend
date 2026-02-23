import ArchivedCampaign from '../models/archivedCampaign.model.js';

// Get users with archived campaigns count
export const getUsersWithArchives = async (req, res) => {
  try {
    const users = await ArchivedCampaign.aggregate([
      {
        $group: {
          _id: '$userId',
          userName: { $first: '$userName' },
          userEmail: { $first: '$userEmail' },
          totalArchived: { $sum: 1 },
          lastArchived: { $max: '$archivedAt' }
        }
      },
      { $sort: { lastArchived: -1 } }
    ]);

    res.json({ success: true, data: users });
  } catch (error) {
    console.error('Get users with archives error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get all archived campaigns (Admin only)
export const getArchivedCampaigns = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, userId } = req.query;

    const query = {};
    
    if (userId) query.userId = userId;
    if (search) {
      query.$or = [
        { campaignName: { $regex: search, $options: 'i' } },
        { campaignId: { $regex: search, $options: 'i' } },
        { userName: { $regex: search, $options: 'i' } }
      ];
    }

    const archives = await ArchivedCampaign.find(query)
      .sort({ archivedAt: -1 })
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
