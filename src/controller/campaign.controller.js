import Campaign from '../models/campaign.model.js';
import Template from '../models/template.model.js';
import jioRCSService from '../services/JioRCS.service.js';

// Check RCS capability for batch of numbers
export const checkCapability = async (req, res) => {
  try {
    const { phoneNumbers } = req.body;
    const userId = req.user._id;

    if (!Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Phone numbers array is required',
      });
    }

    const results = await jioRCSService.checkBatchCapability(phoneNumbers, userId);
    
    res.json({
      success: true,
      data: results,
      summary: {
        total: phoneNumbers.length,
        rcsCapable: results.filter(r => r.isCapable).length,
        notCapable: results.filter(r => !r.isCapable).length,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Create campaign and start sending
export const create = async (req, res) => {
  try {
    const { name, description, templateId, recipients, batchSize, autoStart = true } = req.body;
    const userId = req.user._id;

    const template = await Template.getValidTemplate(templateId, userId);

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Recipients array is required and must not be empty',
      });
    }

    // Count only RCS capable recipients for billing
    const rcsCapableRecipients = recipients.filter(r => r.isRcsCapable === true);
    const actualCost = rcsCapableRecipients.length * 1; // ₹1 per RCS capable number

    // Check wallet balance for RCS capable numbers only
    if (req.user.wallet.balance < actualCost) {
      return res.status(402).json({
        success: false,
        message: 'Insufficient wallet balance',
        required: actualCost,
        available: req.user.wallet.balance,
      });
    }

    const campaign = await Campaign.create({
      name,
      description,
      userId,
      templateId,
      recipients: recipients.map(r => ({
        phoneNumber: r.phoneNumber,
        variables: r.variables || {},
        status: 'pending',
        isRcsCapable: r.isRcsCapable || false,
      })),
      batchSize: batchSize || 100,
      createdBy: userId,
      stats: {
        total: recipients.length,
        pending: recipients.length,
        sent: 0,
        failed: 0,
        processing: 0,
        rcsCapable: rcsCapableRecipients.length,
      },
      status: autoStart ? 'running' : 'draft',
      startedAt: autoStart ? new Date() : null,
      estimatedCost: actualCost,
      actualCost: 0,
    });

    // Deduct wallet balance upfront for RCS capable numbers only
    if (autoStart && actualCost > 0) {
      await req.user.updateWallet(actualCost, 'subtract');
      campaign.actualCost = actualCost;
      await campaign.save();
    }

    // Auto-start campaign processing if requested
    if (autoStart) {
      console.log(`[Campaign] Starting background processing for campaign ${campaign._id}`);
      setImmediate(() => {
        console.log(`[Campaign] Calling processCampaignBatch for ${campaign._id}`);
        jioRCSService.processCampaignBatch(campaign._id, campaign.batchSize, 1000)
          .catch(error => {
            console.error(`[Campaign] Background processing failed for ${campaign._id}:`, error);
          });
      });
    }

    res.status(201).json({
      success: true,
      message: autoStart 
        ? `Campaign created and started! Processing ${recipients.length} total recipients (${rcsCapableRecipients.length} RCS capable, ₹${actualCost} charged)`
        : 'Campaign created successfully',
      data: campaign,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get all campaigns
export const getAll = async (req, res) => {
  try {
    const userId = req.user._id;
    const { status } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    let query = { userId };
    if (status) query.status = status;

    const campaigns = await Campaign.find(query)
      .populate('templateId', 'name templateType')
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip((page - 1) * limit);

    const total = await Campaign.countDocuments(query);

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

// Get campaign details
export const getById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const campaign = await Campaign.findOne({
      _id: id,
      userId,
    }).populate('templateId userId');

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found',
      });
    }

    res.json({
      success: true,
      data: campaign,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Start campaign
export const start = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const campaign = await Campaign.findOneAndUpdate(
      { _id: id, userId, status: 'draft' },
      {
        status: 'running',
        startedAt: new Date(),
      },
      { new: true }
    );

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found or already started',
      });
    }

    setImmediate(() => {
      jioRCSService.processCampaignBatch(id, campaign.batchSize, campaign.delayBetweenBatches);
    });

    res.json({
      success: true,
      message: 'Campaign started successfully',
      data: campaign,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Pause campaign
export const pause = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const campaign = await Campaign.findOneAndUpdate(
      { _id: id, userId, status: 'running' },
      {
        status: 'paused',
        pausedAt: new Date(),
      },
      { new: true }
    );

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found or not running',
      });
    }

    res.json({
      success: true,
      message: 'Campaign paused successfully',
      data: campaign,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get campaign stats
export const getStats = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const campaign = await Campaign.findOne({
      _id: id,
      userId,
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found',
      });
    }

    await campaign.updateStats();

    res.json({
      success: true,
      stats: campaign.stats,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};