import Campaign from '../models/campaign.model.js';
import Template from '../models/template.model.js';
import jioRCSService from '../services/JioRCS.service.js';

// Check RCS capability for batch of numbers
export const checkCapability = async (req, res) => {
  try {
    const { phoneNumbers, countOnly = false, streaming = false, campaignId } = req.body;
    const userId = req.user._id;

    if (!Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Phone numbers array is required',
      });
    }

    console.log(`[Campaign] Checking capability for ${phoneNumbers.length} numbers (countOnly: ${countOnly}, streaming: ${streaming})`);
    
    // Check capability with progress callback that stores in global map
    if (!global.capabilityProgress) global.capabilityProgress = new Map();
    
    const progressKey = `${userId}_${Date.now()}`;
    global.capabilityProgress.set(progressKey, { chunk: 0, total: phoneNumbers.length, rcsCapable: 0 });
    
    // Real-time batch update callback
    const ContactBatch = campaignId ? (await import('../models/contactBatch.model.js')).default : null;
    
    // Mark all batches as processing at start
    if (campaignId && ContactBatch) {
      await ContactBatch.updateMany(
        { campaignId, userId, status: 'pending' },
        { $set: { status: 'processing' } }
      );
      
      // Set global variables for direct database access
      global.currentCampaignId = campaignId;
      global.currentUserId = userId;
    }
    
    let allReachableUsers = [];
    
    const results = await jioRCSService.checkCapabilitySmart(phoneNumbers, userId, campaignId, null, async (progress) => {
      global.capabilityProgress.set(progressKey, progress);
      
      // Accumulate reachable users from all chunks
      if (progress.apiResponse?.reachableUsers) {
        allReachableUsers = [...allReachableUsers, ...progress.apiResponse.reachableUsers];
      }
    });
    
    // For sequential API calls (< 500 contacts), manually save results
    if (campaignId && ContactBatch && phoneNumbers.length < 500) {
      const rcsCapable = results.filter(r => r.isCapable).length;
      
      await ContactBatch.updateMany(
        { campaignId, userId },
        {
          $set: {
            capabilityResults: results,
            processedContacts: phoneNumbers.length,
            rcsCapableCount: rcsCapable,
            status: 'completed',
            processingCompletedAt: new Date()
          }
        }
      );
      
      console.log(`[Campaign] Sequential API: Saved ${results.length} results, ${rcsCapable} RCS capable`);
    }
    
    global.capabilityProgress.delete(progressKey);
    
    // Clean up global variables
    if (global.currentCampaignId) {
      delete global.currentCampaignId;
      delete global.currentUserId;
    }
    
    const rcsCapable = results.filter(r => r.isCapable).length;
    console.log(`[Campaign] ✅ Capability check complete: ${rcsCapable} RCS-capable out of ${phoneNumbers.length}`);
    
    // Final batch update to ensure all are marked as completed
    if (campaignId && ContactBatch) {
      await ContactBatch.updateMany(
        { campaignId, userId },
        { $set: { status: 'completed' } }
      );
    }
    
    const response = {
      success: true,
      data: countOnly ? [] : results,
      summary: {
        total: phoneNumbers.length,
        rcsCapable: rcsCapable,
        notCapable: results.filter(r => !r.isCapable).length,
        apiUsed: phoneNumbers.length >= 500 ? 'batch' : 'sequential'
      },
    };
    
    return res.json(response);
  } catch (error) {
    console.error('[Campaign] Capability check error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
};

// Get capability check progress
export const getCapabilityProgress = async (req, res) => {
  const userId = req.user._id;
  
  // Check in-memory progress first
  let progress = null;
  if (global.capabilityProgress) {
    for (const [key, prog] of global.capabilityProgress.entries()) {
      if (key.startsWith(userId)) {
        progress = prog;
        break;
      }
    }
  }
  
  // If no in-memory progress, check database for actual stats
  if (!progress) {
    const { campaignId } = req.query;
    if (campaignId) {
      const ContactBatch = (await import('../models/contactBatch.model.js')).default;
      const batches = await ContactBatch.find({ campaignId, userId }).select('totalContacts processedContacts rcsCapableCount status');
      
      if (batches.length > 0) {
        const total = batches.reduce((sum, b) => sum + b.totalContacts, 0);
        const processed = batches.reduce((sum, b) => sum + (b.processedContacts || 0), 0);
        const rcsCapable = batches.reduce((sum, b) => sum + (b.rcsCapableCount || 0), 0);
        
        progress = {
          chunk: 0,
          totalChunks: 0,
          total,
          processed,
          rcsCapable
        };
      }
    }
  }
  
  res.json({ success: true, progress });
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
    const { name, description, templateId, recipients, campaignId, batchSize, autoStart = true, isArchived } = req.body;
    const userId = req.user._id;

    console.log(`[Campaign] Bulk send request received:`);
    console.log(`[Campaign] - name: ${name}`);
    console.log(`[Campaign] - templateId: ${templateId}`);
    console.log(`[Campaign] - campaignId: ${campaignId}`);
    console.log(`[Campaign] - isArchived: ${isArchived}`);
    console.log(`[Campaign] - autoStart: ${autoStart}`);
    console.log(`[Campaign] - recipients: ${recipients ? recipients.length : 'fetching from batches'}`);

    // If campaignId is provided, fetch all RCS contacts from batches
    let finalRecipients = recipients;
    if (campaignId && (!recipients || recipients.length === 0)) {
      const ContactBatch = (await import('../models/contactBatch.model.js')).default;
      const batches = await ContactBatch.find({ campaignId, userId }).lean();
      
      console.log(`[Campaign] Found ${batches.length} contact batches for campaignId ${campaignId}`);
      
      const rcsContacts = [];
      for (const batch of batches) {
        console.log(`[Campaign] Processing batch ${batch.batchNumber}: ${batch.totalContacts} total contacts, ${batch.rcsCapableCount} RCS capable`);
        
        if (batch.apiResponse && batch.apiResponse.length > 0) {
          batch.apiResponse.forEach(chunkResponse => {
            if (chunkResponse.reachableUsers) {
              console.log(`[Campaign] - Found ${chunkResponse.reachableUsers.length} reachable users in API response`);
              chunkResponse.reachableUsers.forEach(phoneNumber => {
                const cleanNumber = phoneNumber.replace(/^\+?91/, '');
                rcsContacts.push({
                  phoneNumber: cleanNumber,
                  isRcsCapable: true,
                  variables: {}
                });
                console.log(`[Campaign] - Added RCS contact: ${cleanNumber}`);
              });
            }
          });
        } else if (batch.capabilityResults && batch.capabilityResults.length > 0) {
          console.log(`[Campaign] - Processing ${batch.capabilityResults.length} capability results`);
          batch.capabilityResults.forEach(result => {
            const isCapable = result.isCapable !== undefined ? 
              result.isCapable : 
              (result.features && result.features.length > 0);
            if (isCapable) {
              const cleanNumber = result.phoneNumber.replace(/^\+?91/, '');
              rcsContacts.push({
                phoneNumber: cleanNumber,
                isRcsCapable: true,
                variables: {}
              });
              console.log(`[Campaign] - Added RCS contact: ${cleanNumber}`);
            }
          });
        }
      }
      
      finalRecipients = rcsContacts;
      console.log(`[Campaign] ✅ Total RCS contacts fetched: ${finalRecipients.length}`);
      console.log(`[Campaign] ✅ Contact list: ${finalRecipients.map(r => r.phoneNumber).join(', ')}`);
    }

    // Immediate response for large campaigns
    if (finalRecipients.length > 10000) {
      res.status(202).json({
        success: true,
        message: `Large campaign accepted for processing. ${finalRecipients.length} recipients will be processed in background.`,
        campaignSize: finalRecipients.length,
        processing: true
      });
    }

    const template = await Template.getValidTemplate(templateId, userId);

    // Increment template usage count
    await template.incrementUsage();

    if (!Array.isArray(finalRecipients) || finalRecipients.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Recipients array is required and must not be empty',
      });
    }

    // Count only RCS capable recipients for billing
    const rcsCapableRecipients = finalRecipients.filter(r => r.isRcsCapable === true);
    const actualCost = rcsCapableRecipients.length * 1; // ₹1 per RCS capable number

    // Check available balance (total - blocked)
    const availableBalance = req.user.getAvailableBalance();
    const blockedBalance = req.user.wallet.blockedBalance || 0;
    
    if (availableBalance < actualCost) {
      if (!res.headersSent) {
        // Get active campaigns using blocked balance
        const activeCampaigns = await Campaign.find({
          userId: req.user._id,
          status: { $in: ['running', 'scheduled'] },
          blockedAmount: { $gt: 0 }
        }).select('name blockedAmount');
        
        const campaignDetails = activeCampaigns.map(c => `"${c.name}" (₹${c.blockedAmount})`).join(', ');
        
        return res.status(402).json({
          success: false,
          message: blockedBalance > 0 
            ? `Insufficient available balance. ₹${actualCost} will be deducted upfront and refunded for failed messages. Currently ₹${blockedBalance} is being used in active campaign(s): ${campaignDetails}.`
            : `Insufficient wallet balance. ₹${actualCost} will be deducted upfront and refunded for failed messages.`,
          required: actualCost,
          available: availableBalance,
          totalBalance: req.user.wallet.balance,
          blockedBalance: blockedBalance,
          activeCampaigns: activeCampaigns.map(c => ({
            name: c.name,
            blockedAmount: c.blockedAmount
          }))
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
    const optimizedBatchSize = finalRecipients.length > 50000 ? 500 : 
                              finalRecipients.length > 10000 ? 300 : 
                              finalRecipients.length > 1000 ? 200 : 100;

    // Update existing campaign or create new one
    let campaign;
    if (campaignId) {
      // Update existing campaign with recipients and start it
      campaign = await Campaign.findByIdAndUpdate(
        campaignId,
        {
          recipients: finalRecipients.map(r => ({
            phoneNumber: r.phoneNumber,
            variables: r.variables || {},
            status: 'pending',
            isRcsCapable: r.isRcsCapable || false,
          })),
          batchSize: batchSize || optimizedBatchSize,
          stats: {
            total: finalRecipients.length,
            pending: finalRecipients.length,
            sent: 0,
            failed: 0,
            processing: 0,
            rcsCapable: rcsCapableRecipients.length,
          },
          status: autoStart ? 'running' : 'draft',
          startedAt: autoStart ? new Date() : null,
          isArchived: isArchived !== undefined ? isArchived : false,
          estimatedCost: actualCost,
          actualCost: 0,
          blockedAmount: 0,
        },
        { new: true }
      );
      console.log(`[Campaign] Updated existing campaign ${campaignId}`);
    } else {
      // Create new campaign
      campaign = await Campaign.create({
        name,
        description,
        userId,
        templateId,
        recipients: finalRecipients.map(r => ({
          phoneNumber: r.phoneNumber,
          variables: r.variables || {},
          status: 'pending',
          isRcsCapable: r.isRcsCapable || false,
        })),
        batchSize: batchSize || optimizedBatchSize,
        createdBy: userId,
        stats: {
          total: finalRecipients.length,
          pending: finalRecipients.length,
          sent: 0,
          failed: 0,
          processing: 0,
          rcsCapable: rcsCapableRecipients.length,
        },
        status: autoStart ? 'running' : 'draft',
        startedAt: autoStart ? new Date() : null,
        isArchived: false,
        estimatedCost: actualCost,
        actualCost: 0,
        blockedAmount: 0,
      });
      console.log(`[Campaign] Created new campaign ${campaign._id}`);
    }

    // Block wallet balance for this campaign
    if (autoStart && actualCost > 0) {
      await req.user.blockBalance(actualCost, campaign._id);
      campaign.blockedAmount = actualCost;
      await campaign.save();
      console.log(`[Campaign] Blocked ₹${actualCost} from user wallet`);
    }

    // Wallet will be deducted per message on delivery (see webhook.controller.js)
    // No upfront deduction

    // Auto-start campaign processing if requested
    if (autoStart) {
      console.log(`[Campaign] Starting campaign "${name}" (${campaign._id})`);
      console.log(`[Campaign] Sending to ${rcsCapableRecipients.length} RCS-capable recipients:`);
      console.log(`[Campaign] Phone numbers: ${rcsCapableRecipients.map(r => r.phoneNumber).join(', ')}`);
      console.log(`[Campaign] Total recipients: ${finalRecipients.length}, RCS capable: ${rcsCapableRecipients.length}, Cost: ₹${actualCost}`);
      
      // Update user stats when campaign is created and started
      await req.user.updateStats({
        messagesSent: finalRecipients.length,
        totalMessages: finalRecipients.length,
        cost: actualCost,
        actualCost: actualCost
      });
      
      // Update user usage stats
      await req.user.incrementUsage('campaigns', 1);
      await req.user.incrementUsage('messages', rcsCapableRecipients.length);
      
      // For large campaigns, use setImmediate to prevent blocking
      if (finalRecipients.length > 10000) {
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
    if (finalRecipients.length <= 10000) {
      res.status(201).json({
        success: true,
        message: autoStart 
          ? `Campaign created and started! Processing ${finalRecipients.length} total recipients (${rcsCapableRecipients.length} RCS capable, ₹${actualCost} charged)`
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

// Get all campaigns for a user (for reports) with backend pagination
export const getUserCampaignReports = async (req, res) => {
  try {
    const { userId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const { search, status, type, campaign, startDate, endDate, sort = 'newest' } = req.query;
    
    // Build query - always filter out archived campaigns
    let query = { userId, isArchived: false };
    
    // Status filter
    if (status && status !== 'all') {
      if (status === 'processing') {
        query.status = { $in: ['processing', 'running'] };
      } else {
        query.status = status;
      }
    }
    
    // Campaign name filter
    if (campaign && campaign !== 'all') {
      query.name = campaign;
    }
    
    // Date range filter
    if (startDate && endDate) {
      query.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }
    
    // Type filter - need to get template IDs first
    if (type && type !== 'all') {
      const matchingTemplates = await Template.find({ templateType: type }).select('_id');
      const templateIds = matchingTemplates.map(t => t._id);
      if (templateIds.length > 0) {
        query.templateId = { $in: templateIds };
      } else {
        // No templates found, return empty
        return res.json({
          success: true,
          data: [],
          pagination: {
            page,
            limit,
            total: 0,
            pages: 0,
            totalDelivered: 0,
            totalFailed: 0
          }
        });
      }
    }
    
    // Search filter in MongoDB query
    if (search && search.trim()) {
      query.$or = [
        { name: { $regex: search.trim(), $options: 'i' } }
      ];
    }
    
    // Sort order
    const sortOrder = sort === 'oldest' ? 1 : -1;
    
    // Get total count with filters
    const total = await Campaign.countDocuments(query);
    
    // Get paginated campaigns
    const campaigns = await Campaign.find(query)
      .populate('templateId', 'name templateType')
      .sort({ createdAt: sortOrder })
      .limit(limit)
      .skip((page - 1) * limit)
      .select('name description status stats estimatedCost actualCost createdAt completedAt')
      .lean();
    
    // Get Message model to aggregate interaction counts
    const Message = (await import('../models/message.model.js')).default;
    
    // Get interaction counts for current page campaigns only
    const campaignIds = campaigns.map(c => c._id);
    const interactionStats = await Message.aggregate([
      { $match: { campaignId: { $in: campaignIds } } },
      {
        $group: {
          _id: '$campaignId',
          totalInteractions: { $sum: '$userClickCount' },
          totalReplies: { $sum: '$userReplyCount' }
        }
      }
    ]);
    
    // Create a map for quick lookup
    const interactionMap = {};
    interactionStats.forEach(stat => {
      interactionMap[stat._id.toString()] = {
        interactions: stat.totalInteractions || 0,
        replies: stat.totalReplies || 0
      };
    });
    
    // Transform campaigns to match frontend expectations
    const reports = campaigns.map(campaign => {
      const interactions = interactionMap[campaign._id.toString()] || { interactions: 0, replies: 0 };
      return {
        _id: campaign._id,
        CampaignName: campaign.name,
        type: campaign.templateId?.templateType,
        cost: campaign.stats?.total || 0,
        successCount: campaign.stats?.sent || 0,
        failedCount: campaign.stats?.failed || 0,
        bouncedCount: campaign.stats?.bounced || 0,
        totalDelivered: campaign.stats?.delivered || 0,
        totalRead: campaign.stats?.read || 0,
        totalReplied: campaign.stats?.replied || 0,
        userClickCount: interactions.interactions,
        createdAt: campaign.createdAt,
        completedAt: campaign.completedAt,
        status: campaign.status,
        recipients: undefined,
        actualCost: campaign.actualCost || 0,
        estimatedCost: campaign.estimatedCost || 0
      };
    });
    

    
    // Calculate aggregate stats for all campaigns (not just current page) - exclude archived
    const allCampaigns = await Campaign.find({ userId, isArchived: false }).select('stats').lean();
    const aggregateStats = allCampaigns.reduce((acc, campaign) => {
      acc.totalDelivered += campaign.stats?.delivered || 0;
      acc.totalFailed += campaign.stats?.failed || 0;
      return acc;
    }, { totalDelivered: 0, totalFailed: 0 });
    
    res.json({
      success: true,
      data: reports,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
        totalDelivered: aggregateStats.totalDelivered,
        totalFailed: aggregateStats.totalFailed
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

// Admin: Get all campaigns from all users
export const getAllForAdmin = async (req, res) => {
  try {
    let { status, type, user, search, sort = 'newest' } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    // Fix: If search is an array, take the first element
    if (Array.isArray(search)) {
      search = search[0];
    }

    // console.log('[Campaign] getAllForAdmin - Query params:', { status, type, user, search, sort, page, limit });

    let query = {};
    if (status) query.status = status;
    
    // Handle type filter by first finding matching templates
    let templateIds = [];
    if (type) {
      const Template = (await import('../models/template.model.js')).default;
      const matchingTemplates = await Template.find({ templateType: type }).select('_id');
      templateIds = matchingTemplates.map(t => t._id);
      if (templateIds.length > 0) {
        query.templateId = { $in: templateIds };
      } else {
        // No templates found with this type, return empty result
        return res.json({
          success: true,
          data: [],
          pagination: {
            page,
            limit,
            total: 0,
            pages: 0,
            totalCampaigns: 0,
            totalDelivered: 0,
            totalFailed: 0
          },
        });
      }
    }

    const sortOrder = sort === 'oldest' ? 1 : -1;

    // Get all campaigns matching basic filters
    let allCampaigns = await Campaign.find(query)
      .populate('templateId', 'name templateType')
      .populate('userId', 'name email')
      .sort({ createdAt: sortOrder })
      .lean();

    // console.log('[Campaign] Total campaigns before filtering:', allCampaigns.length);

    // Apply search filter
    if (search) {
      const searchLower = String(search).toLowerCase();
      allCampaigns = allCampaigns.filter(c => {
        const matchName = c.name?.toLowerCase().includes(searchLower);
        const matchUserName = c.userId?.name?.toLowerCase().includes(searchLower);
        const matchUserEmail = c.userId?.email?.toLowerCase().includes(searchLower);
        const matchId = c._id.toString().toLowerCase().includes(searchLower);
        return matchName || matchUserName || matchUserEmail || matchId;
      });
      console.log('[Campaign] After search filter:', allCampaigns.length);
    }

    // Apply user filter
    if (user) {
      allCampaigns = allCampaigns.filter(c => c.userId?.name === user);
      console.log('[Campaign] After user filter:', allCampaigns.length);
    }

    // Apply pagination
    const total = allCampaigns.length;
    const startIndex = (page - 1) * limit;
    const paginatedCampaigns = allCampaigns.slice(startIndex, startIndex + limit);

    // console.log('[Campaign] Paginated campaigns:', paginatedCampaigns.length);

    // Get universal stats
    const allCampaignsForStats = await Campaign.find({}).select('stats');
    const universalStats = allCampaignsForStats.reduce((acc, campaign) => {
      acc.totalCampaigns += 1;
      acc.totalDelivered += campaign.stats?.sent || 0;
      acc.totalFailed += campaign.stats?.failed || 0;
      return acc;
    }, { totalCampaigns: 0, totalDelivered: 0, totalFailed: 0 });

    const transformedCampaigns = paginatedCampaigns.map(campaign => ({
      _id: campaign._id,
      CampaignName: campaign.name,
      type: campaign.templateId?.templateType,
      cost: campaign.stats?.total || 0,
      successCount: campaign.stats?.sent || 0,
      failedCount: campaign.stats?.failed || 0,
      status: campaign.status,
      createdAt: campaign.createdAt,
      userId: campaign.userId
    }));

    res.json({
      success: true,
      data: transformedCampaigns,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        ...universalStats
      },
    });
  } catch (error) {
    console.error('[Campaign] Admin get all error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Admin: Get campaign messages
export const getCampaignMessages = async (req, res) => {
  try {
    const { id } = req.params;
    const { search, status } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const campaign = await Campaign.findById(id);
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found',
      });
    }

    // Use Message model for detailed message data
    const Message = (await import('../models/message.model.js')).default;
    
    let query = { campaignId: id };
    if (search) {
      query.recipientPhoneNumber = { $regex: search, $options: 'i' };
    }
    if (status && status !== 'all') {
      query.status = status;
    }
    
    const messages = await Message.find(query)
      .select('recipientPhoneNumber status templateType sentAt deliveredAt readAt clickedAt clickedAction userText suggestionResponse userClickCount userReplyCount errorMessage errorCode createdAt')
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip((page - 1) * limit)
      .lean();
    
    const total = await Message.countDocuments(query);

    // Transform messages to match frontend expectations
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
      errorCode: msg.errorCode,
      createdAt: msg.createdAt
    }));

    res.json({
      success: true,
      data: transformedMessages,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('[Campaign] Admin get messages error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Admin: Get ALL campaign messages for export (no pagination)
export const getAllCampaignMessagesForExport = async (req, res) => {
  try {
    const { campaignId } = req.params;

    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found',
      });
    }

    const Message = (await import('../models/message.model.js')).default;
    
    const messages = await Message.find({ campaignId })
      .select('recipientPhoneNumber status templateType sentAt deliveredAt readAt clickedAt clickedAction userText suggestionResponse userClickCount userReplyCount errorMessage errorCode createdAt')
      .sort({ createdAt: -1 })
      .lean();

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
      errorCode: msg.errorCode,
      createdAt: msg.createdAt
    }));

    res.json({
      success: true,
      data: transformedMessages,
      total: transformedMessages.length
    });
  } catch (error) {
    console.error('[Campaign] Export campaign messages error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Admin: Get ALL campaigns for export (no pagination)
export const getAllCampaignsForExport = async (req, res) => {
  try {
    let { status, type, user, search, sort = 'newest' } = req.query;

    // Fix: If search is an array, take the first element
    if (Array.isArray(search)) {
      search = search[0];
    }

    let query = {};
    if (status) query.status = status;
    
    // Handle type filter by first finding matching templates
    if (type) {
      const Template = (await import('../models/template.model.js')).default;
      const matchingTemplates = await Template.find({ templateType: type }).select('_id');
      const templateIds = matchingTemplates.map(t => t._id);
      if (templateIds.length > 0) {
        query.templateId = { $in: templateIds };
      } else {
        // No templates found with this type, return empty result
        return res.json({
          success: true,
          data: [],
          total: 0
        });
      }
    }

    const sortOrder = sort === 'oldest' ? 1 : -1;

    let campaigns = await Campaign.find(query)
      .populate('templateId', 'name templateType')
      .populate('userId', 'name email')
      .sort({ createdAt: sortOrder })
      .lean();

    // Filter by user name if provided
    if (user) {
      campaigns = campaigns.filter(c => c.userId?.name === user);
    }

    // Filter by search
    if (search) {
      const searchLower = String(search).toLowerCase();
      campaigns = campaigns.filter(c => 
        c.name?.toLowerCase().includes(searchLower) ||
        c.userId?.name?.toLowerCase().includes(searchLower) ||
        c.userId?.email?.toLowerCase().includes(searchLower) ||
        c._id.toString().includes(searchLower)
      );
    }

    const transformedCampaigns = campaigns.map(campaign => ({
      _id: campaign._id,
      CampaignName: campaign.name,
      type: campaign.templateId?.templateType,
      cost: campaign.stats?.total || 0,
      successCount: campaign.stats?.sent || 0,
      failedCount: campaign.stats?.failed || 0,
      status: campaign.status,
      createdAt: campaign.createdAt,
      userId: campaign.userId
    }));

    res.json({
      success: true,
      data: transformedCampaigns,
      total: transformedCampaigns.length
    });
  } catch (error) {
    console.error('[Campaign] Export all campaigns error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};


// Upload contacts in batches
export const uploadContactBatch = async (req, res) => {
  try {
    const { campaignId, batchNumber, phoneNumbers } = req.body;
    const userId = req.user._id;

    const ContactBatch = (await import('../models/contactBatch.model.js')).default;

    const batch = await ContactBatch.create({
      campaignId,
      userId,
      batchNumber,
      phoneNumbers: phoneNumbers, // Store phone numbers
      totalContacts: phoneNumbers.length,
      status: 'pending'
    });

    res.json({
      success: true,
      message: `Batch ${batchNumber} uploaded successfully`,
      data: batch
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Process contact batch for capability check
export const processContactBatch = async (req, res) => {
  try {
    const { batchId } = req.params;
    const userId = req.user._id;

    const ContactBatch = (await import('../models/contactBatch.model.js')).default;
    const batch = await ContactBatch.findOne({ _id: batchId, userId });

    if (!batch) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found'
      });
    }

    await batch.startProcessing();

    const results = await jioRCSService.checkCapabilityBatchWithSave(
      batch.phoneNumbers, 
      userId, 
      batch.campaignId, 
      batch.batchNumber
    );

    // Results are already saved by checkCapabilityBatchWithSave
    // Just reload the batch to get updated data
    const updatedBatch = await ContactBatch.findById(batchId);

    res.json({
      success: true,
      data: updatedBatch,
      summary: {
        total: updatedBatch.totalContacts,
        rcsCapable: updatedBatch.rcsCapableCount,
        notCapable: updatedBatch.totalContacts - updatedBatch.rcsCapableCount
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Get contact batches with pagination and populate data
export const getContactBatchesWithData = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const ContactBatch = (await import('../models/contactBatch.model.js')).default;
    
    const batches = await ContactBatch.find({ campaignId, userId })
      .sort({ batchNumber: 1 })
      .limit(limit)
      .skip((page - 1) * limit)
      .lean();

    const total = await ContactBatch.countDocuments({ campaignId, userId });

    res.json({
      success: true,
      data: batches,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Get contact batches with pagination
export const getContactBatches = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const status = req.query.status;

    const ContactBatch = (await import('../models/contactBatch.model.js')).default;
    
    let query = { campaignId, userId };
    if (status) query.status = status;

    const batches = await ContactBatch.find(query)
      .sort({ batchNumber: 1 })
      .limit(limit)
      .skip((page - 1) * limit)
      .select('-phoneNumbers -capabilityResults')
      .lean();

    const total = await ContactBatch.countDocuments(query);

    res.json({
      success: true,
      data: batches,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Get single batch with contacts
export const getContactBatchById = async (req, res) => {
  try {
    const { batchId } = req.params;
    const userId = req.user._id;

    const ContactBatch = (await import('../models/contactBatch.model.js')).default;
    const batch = await ContactBatch.findOne({ _id: batchId, userId });

    if (!batch) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found'
      });
    }

    res.json({
      success: true,
      data: batch
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Get all contacts from batches with pagination
export const getAllContactsFromBatches = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;

    const ContactBatch = (await import('../models/contactBatch.model.js')).default;
    
    const batches = await ContactBatch.find({ campaignId, userId })
      .sort({ batchNumber: 1 })
      .lean();

    const allContacts = [];
    
    for (const batch of batches) {
      if (batch.apiResponse && batch.apiResponse.length > 0 && batch.phoneNumbers && batch.phoneNumbers.length > 0) {
        // Collect all reachableUsers from API response
        const reachableSet = new Set();
        batch.apiResponse.forEach(chunkResponse => {
          if (chunkResponse.reachableUsers) {
            chunkResponse.reachableUsers.forEach(phone => {
              reachableSet.add(phone.replace(/^\+?91/, ''));
            });
          }
        });
        
        // Add ALL contacts with proper capability status
        batch.phoneNumbers.forEach(phoneNumber => {
          const cleanPhone = phoneNumber.replace(/^\+?91/, '');
          allContacts.push({
            phoneNumber: cleanPhone,
            isRcsCapable: reachableSet.has(cleanPhone),
            batchNumber: batch.batchNumber,
            batchStatus: batch.status
          });
        });
      } else if (batch.capabilityResults && batch.capabilityResults.length > 0) {
        // Fallback to capability results if available
        batch.capabilityResults.forEach(result => {
          // Determine isCapable from features array if isCapable field is missing
          const isCapable = result.isCapable !== undefined ? 
            result.isCapable : 
            (result.features && result.features.length > 0);
            
          allContacts.push({
            phoneNumber: result.phoneNumber.replace(/^\+?91/, ''),
            isRcsCapable: isCapable,
            batchNumber: batch.batchNumber,
            batchStatus: batch.status
          });
        });
      } else {
        // Fallback: If no data available but totalContacts > 0, show placeholder contacts
        if (batch.totalContacts > 0 && batch.phoneNumbers.length === 0) {
          for (let i = 0; i < Math.min(batch.totalContacts, 1000); i++) {
            allContacts.push({
              phoneNumber: `Contact ${i + 1}`,
              isRcsCapable: null,
              batchNumber: batch.batchNumber,
              batchStatus: batch.status
            });
          }
        } else {
          // Use phone numbers with null capability if not processed yet
          batch.phoneNumbers.forEach(phone => {
            allContacts.push({
              phoneNumber: phone,
              isRcsCapable: null,
              batchNumber: batch.batchNumber,
              batchStatus: batch.status
            });
          });
        }
      }
    }

    const total = allContacts.length;
    const paginatedContacts = allContacts.slice((page - 1) * limit, page * limit);

    res.json({
      success: true,
      data: paginatedContacts,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Fix missing capability results for batches
export const fixMissingCapabilityResults = async (req, res) => {
  try {
    const { campaignId } = req.query;
    const userId = req.user._id;

    console.log(`[Campaign] Fixing missing capability results for user ${userId}`);
    
    const result = await jioRCSService.fixMissingCapabilityResults(campaignId, userId);
    
    res.json({
      success: true,
      message: `Fixed ${result.fixed} out of ${result.total} batches`,
      data: result
    });
  } catch (error) {
    console.error('[Campaign] Fix missing results error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Get paginated reachable users for sending messages
export const getReachableUsers = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const batchNumber = req.query.batchNumber;

    const ContactBatch = (await import('../models/contactBatch.model.js')).default;
    
    let query = { campaignId, userId };
    if (batchNumber) query.batchNumber = batchNumber;
    
    const batches = await ContactBatch.find(query)
      .sort({ batchNumber: 1 })
      .lean();

    const reachableUsers = [];
    
    for (const batch of batches) {
      if (batch.apiResponse && batch.apiResponse.length > 0) {
        // Collect all reachableUsers from all chunks (batch API)
        batch.apiResponse.forEach(chunkResponse => {
          if (chunkResponse.reachableUsers) {
            chunkResponse.reachableUsers.forEach(phoneNumber => {
              reachableUsers.push({
                phoneNumber: phoneNumber.replace(/^\+?91/, ''),
                isRcsCapable: true,
                batchNumber: batch.batchNumber
              });
            });
          }
        });
      } else if (batch.capabilityResults && batch.capabilityResults.length > 0) {
        // Collect RCS capable users from capabilityResults (sequential API)
        batch.capabilityResults.forEach(result => {
          // Determine isCapable from features array if isCapable field is missing
          const isCapable = result.isCapable !== undefined ? 
            result.isCapable : 
            (result.features && result.features.length > 0);
            
          if (isCapable) {
            reachableUsers.push({
              phoneNumber: result.phoneNumber.replace(/^\+?91/, ''),
              isRcsCapable: true,
              batchNumber: batch.batchNumber
            });
          }
        });
      }
    }

    const total = reachableUsers.length;
    const paginatedUsers = reachableUsers.slice((page - 1) * limit, page * limit);

    res.json({
      success: true,
      data: paginatedUsers,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Delete contact from batch
export const deleteContactFromBatch = async (req, res) => {
  try {
    const { campaignId, phoneNumber } = req.params;
    const userId = req.user._id;

    const ContactBatch = (await import('../models/contactBatch.model.js')).default;
    
    const batches = await ContactBatch.find({ campaignId, userId });
    
    let deleted = false;
    let wasRcsCapable = false;
    
    for (const batch of batches) {
      const cleanPhone = phoneNumber.replace(/^\+?91/, '');
      const formattedPhone = `+91${cleanPhone}`;
      
      // Check if contact exists in phoneNumbers
      const phoneIndex = batch.phoneNumbers.findIndex(p => 
        p.replace(/^\+?91/, '') === cleanPhone
      );
      
      if (phoneIndex === -1) continue;
      
      // Check if it was RCS capable (in apiResponse)
      if (batch.apiResponse && batch.apiResponse.length > 0) {
        for (const chunk of batch.apiResponse) {
          if (chunk.reachableUsers && chunk.reachableUsers.includes(formattedPhone)) {
            wasRcsCapable = true;
            // Remove from reachableUsers
            chunk.reachableUsers = chunk.reachableUsers.filter(p => p !== formattedPhone);
          }
        }
      }
      
      // Remove from phoneNumbers
      batch.phoneNumbers.splice(phoneIndex, 1);
      
      // Remove from capabilityResults if exists
      if (batch.capabilityResults && batch.capabilityResults.length > 0) {
        batch.capabilityResults = batch.capabilityResults.filter(r => 
          r.phoneNumber.replace(/^\+?91/, '') !== cleanPhone
        );
      }
      
      // Update counts
      batch.totalContacts = batch.phoneNumbers.length;
      if (wasRcsCapable && batch.rcsCapableCount > 0) {
        batch.rcsCapableCount -= 1;
      }
      
      await batch.save();
      deleted = true;
      break;
    }

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Contact not found'
      });
    }

    res.json({
      success: true,
      message: 'Contact deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
