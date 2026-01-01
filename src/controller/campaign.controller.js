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

    let results;
    
    if (phoneNumbers.length > 500) {
      // Use batch API for more than 500 numbers
      console.log(`[Campaign] Using batch API for ${phoneNumbers.length} numbers`);
      results = await jioRCSService.checkCapabilityBatch(phoneNumbers, userId);
    } else {
      // Use smart capability check for 500 or fewer numbers
      console.log(`[Campaign] Using sequential API for ${phoneNumbers.length} numbers`);
      results = await jioRCSService.checkCapabilitySequential(phoneNumbers, userId);
    }
    
    res.json({
      success: true,
      data: results,
      summary: {
        total: phoneNumbers.length,
        rcsCapable: results.filter(r => r.isCapable).length,
        notCapable: results.filter(r => !r.isCapable).length,
        apiUsed: phoneNumbers.length > 500 ? 'batch' : 'sequential'
      },
    });
  } catch (error) {
    console.error('[Campaign] Capability check error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Create simple campaign record
export const createSimple = async (req, res) => {
  try {
    const { name, templateId, userId, status = 'draft', totalRecipients, estimatedCost } = req.body;
    const requestUserId = req.user._id;

    // Validate template exists
    const template = await Template.findById(templateId);
    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Template not found',
      });
    }

    const campaign = await Campaign.create({
      name,
      userId: requestUserId,
      templateId,
      status: 'running', // Auto-start campaigns
      startedAt: new Date(),
      recipients: [], // Will be populated when contacts are uploaded
      stats: {
        total: totalRecipients || 0,
        pending: totalRecipients || 0,
        sent: 0,
        failed: 0,
        processing: 0,
        rcsCapable: 0,
      },
      estimatedCost: estimatedCost || 0,
      actualCost: 0,
      createdAt: new Date(),
    });

    res.status(201).json({
      success: true,
      message: 'Campaign created successfully',
      data: campaign,
    });
  } catch (error) {
    console.error('[Campaign] Simple creation error:', error);
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

    // Immediate response for large campaigns
    if (recipients.length > 10000) {
      res.status(202).json({
        success: true,
        message: `Large campaign accepted for processing. ${recipients.length} recipients will be processed in background.`,
        campaignSize: recipients.length,
        processing: true
      });
    }

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
      if (!res.headersSent) {
        return res.status(402).json({
          success: false,
          message: 'Insufficient wallet balance',
          required: actualCost,
          available: req.user.wallet.balance,
        });
      }
      return;
    }

    // Check rate limits for large campaigns
    if (!req.user.checkRateLimit('messages')) {
      if (!res.headersSent) {
        return res.status(429).json({
          success: false,
          message: 'Daily message limit exceeded',
          limit: req.user.rateLimits.messagesPerDay,
          used: req.user.rateLimits.currentDayUsage.messages,
        });
      }
      return;
    }

    // Dynamic batch size based on campaign volume (max 500)
    const optimizedBatchSize = recipients.length > 50000 ? 500 : 
                              recipients.length > 10000 ? 300 : 
                              recipients.length > 1000 ? 200 : 100;

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
      batchSize: batchSize || optimizedBatchSize,
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
      console.log(`[Campaign] Starting background processing for campaign ${campaign._id} with ${recipients.length} recipients`);
      
      // Update user usage stats
      await req.user.incrementUsage('campaigns', 1);
      await req.user.incrementUsage('messages', rcsCapableRecipients.length);
      
      // For large campaigns, use setImmediate to prevent blocking
      if (recipients.length > 10000) {
        setImmediate(() => {
          jioRCSService.processCampaignBatch(campaign._id, optimizedBatchSize, 500)
            .catch(error => {
              console.error(`[Campaign] Background processing failed for ${campaign._id}:`, error);
              // Mark campaign as failed
              Campaign.updateOne({ _id: campaign._id }, { status: 'failed' }).catch(console.error);
            });
        });
      } else {
        setImmediate(() => {
          jioRCSService.processCampaignBatch(campaign._id, optimizedBatchSize, 1000)
            .catch(error => {
              console.error(`[Campaign] Background processing failed for ${campaign._id}:`, error);
              // Mark campaign as failed
              Campaign.updateOne({ _id: campaign._id }, { status: 'failed' }).catch(console.error);
            });
        });
      }
    }

    // Send appropriate response based on campaign size
    if (recipients.length <= 10000) {
      res.status(201).json({
        success: true,
        message: autoStart 
          ? `Campaign created and started! Processing ${recipients.length} total recipients (${rcsCapableRecipients.length} RCS capable, ₹${actualCost} charged)`
          : 'Campaign created successfully',
        data: campaign,
      });
    }
    // Large campaigns already responded above
    
  } catch (error) {
    console.error('[Campaign] Creation error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
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

// Restart campaign processing
export const restart = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const campaign = await Campaign.findOne({ _id: id, userId });
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found',
      });
    }

    // Restart campaign processing
    const result = await jioRCSService.restartCampaign(id);
    
    res.json({
      success: true,
      message: 'Campaign processing restarted',
      data: result
    });
  } catch (error) {
    console.error('[Campaign] Restart error:', error);
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