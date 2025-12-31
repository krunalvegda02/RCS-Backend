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
    const reports = campaigns.map(campaign => ({
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
      data: reports,
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
    
      const Message = (await import('../models/message.model.js')).default;
    
    // Fetch messages from Message model with useful fields only
    const messages = await Message.find({ campaignId })
      .select('recipientPhoneNumber status templateType sentAt deliveredAt readAt clickedAt clickedAction userText suggestionResponse userClickCount userReplyCount errorMessage createdAt')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .lean();
    
    const total = await Message.countDocuments({ campaignId });
    
    // Transform messages to include only useful reporting fields
    const transformedMessages = messages.map(msg => ({
      _id: msg._id,
      phoneNumber: msg.recipientPhoneNumber,
      status: msg.status,
      templateType: msg.templateType,
      sentAt: msg.sentAt,
      deliveredAt: msg.deliveredAt,
      readAt: msg.readAt,
      clickedAt: msg.clickedAt,
      clickedAction: msg.clickedAction,
      userText: msg.userText,
      suggestionResponse: msg.suggestionResponse,
      interactions: msg.userClickCount || 0,
      replies: msg.userReplyCount || 0,
      errorMessage: msg.errorMessage,
      createdAt: msg.createdAt
    }));
    
    res.json({
      success: true,
      data: transformedMessages,
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
      message: 'Failed to fetch campaign messages',
      error: error.message
    });
  }
};