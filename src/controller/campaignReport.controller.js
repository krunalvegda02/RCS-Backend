import CampaignReport from '../models/campaignReport.model.js';

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

// Get all reports for a user
export const getUserCampaignReports = async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 10 } = req.query;
    
    const reports = await CampaignReport.find({ userId })
      .sort({ generatedAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const total = await CampaignReport.countDocuments({ userId });
    
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
      message: 'Failed to fetch user campaign reports',
      error: error.message
    });
  }
};

// Delete campaign report
export const deleteCampaignReport = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const report = await CampaignReport.findOneAndDelete({ campaignId });
    
    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Campaign report not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Campaign report deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to delete campaign report',
      error: error.message
    });
  }
};