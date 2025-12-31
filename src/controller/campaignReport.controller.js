import CampaignReport from '../models/campaignReport.model.js';
import Campaign from '../models/campaign.model.js';

// Generate report for a campaign
export const generateCampaignReport = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const report = await CampaignReport.generateForCampaign(campaignId);
    
    res.json({
      success: true,
      data: report
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to generate campaign report',
      error: error.message
    });
  }
};

// Get report by campaign ID
export const getCampaignReport = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const report = await CampaignReport.findOne({ campaignId });
    
    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Campaign report not found'
      });
    }
    
    res.json({
      success: true,
      data: report
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch campaign report',
      error: error.message
    });
  }
};

// Get all campaigns for a user (modified to return campaigns instead of reports)
export const getUserCampaignReports = async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 10 } = req.query;
    
    const campaigns = await Campaign.find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .select('name description status stats estimatedCost actualCost createdAt completedAt recipients')
      .lean();
    
    // Transform campaigns to match frontend expectations
    const transformedCampaigns = campaigns.map(campaign => ({
      _id: campaign._id,
      CampaignName: campaign.name,
      type: 'RCS',
      cost: campaign.recipients?.length || 0,
      successCount: campaign.stats?.sent || 0,
      failedCount: campaign.stats?.failed || 0,
      bouncedCount: campaign.stats?.bounced || 0,
      totalDelivered: campaign.stats?.delivered || 0,
      totalRead: campaign.stats?.read || 0,
      totalReplied: campaign.stats?.replied || 0,
      userClickCount: campaign.stats?.replied || 0,
      createdAt: campaign.createdAt,
      completedAt: campaign.completedAt,
      status: campaign.status,
      recipients: campaign.recipients,
      actualCost: campaign.actualCost || 0,
      estimatedCost: campaign.estimatedCost || 0
    }));
    
    const total = await Campaign.countDocuments({ userId });
    
    res.json({
      success: true,
      data: transformedCampaigns,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user campaigns',
      error: error.message
    });
  }
};

// Get campaign messages with status
export const getCampaignMessages = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    
    const campaign = await Campaign.findById(campaignId)
      .select('recipients name')
      .lean();
    
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }
    
    // Paginate recipients
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedRecipients = campaign.recipients.slice(startIndex, endIndex);
    
    res.json({
      success: true,
      data: {
        campaignName: campaign.name,
        messages: paginatedRecipients.map(recipient => ({
          _id: recipient._id,
          phoneNumber: recipient.phoneNumber,
          status: recipient.status,
          isRcsCapable: recipient.isRcsCapable,
          sentAt: recipient.sentAt,
          deliveredAt: recipient.deliveredAt,
          readAt: recipient.readAt,
          failedAt: recipient.failedAt,
          errorMessage: recipient.errorMessage
        }))
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: campaign.recipients.length,
        pages: Math.ceil(campaign.recipients.length / limit)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch campaign messages',
      error: error.message
    });
  }
};