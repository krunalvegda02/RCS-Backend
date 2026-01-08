import Campaign from '../models/campaign.model.js';
import Template from '../models/template.model.js';
import jioRCSService from '../services/JioRCS.service.js';
import mongoose from 'mongoose';

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

    console.log(`\n========== CAPABILITY CHECK START ==========`);
    console.log(`[Campaign] Checking capability for ${phoneNumbers.length} numbers`);
    console.log(`[Campaign] Sample numbers:`, phoneNumbers.slice(0, 5));

    let results;
    let apiUsed;

    // Use sequential API for < 500, batch API for >= 500
    if (phoneNumbers.length < 500) {
      console.log(`[Campaign] Using sequential API for ${phoneNumbers.length} numbers`);
      results = await jioRCSService.checkCapabilitySequential(phoneNumbers, userId);
      apiUsed = 'sequential';
    } else {
      console.log(`[Campaign] Using batch API for ${phoneNumbers.length} numbers`);
      const accessToken = await jioRCSService.getAccessToken(userId);
      const capableNumbers = await jioRCSService.checkCapabilityFast(phoneNumbers, accessToken);

      const capableSet = new Set(capableNumbers);
      results = phoneNumbers.map(phone => {
        const formatted = phone.startsWith('+') ? phone : `+91${phone.replace(/\D/g, '')}`;
        return {
          phoneNumber: formatted,
          isCapable: capableSet.has(formatted),
          features: capableSet.has(formatted) ? ['RCS_MESSAGING'] : [],
          capabilityToken: null,
          checkedAt: new Date()
        };
      });
      apiUsed = 'batch';
    }

    const rcsCapable = results.filter(r => r.isCapable).length;
    const notCapable = results.filter(r => !r.isCapable).length;
    console.log(`[Campaign] ✅ Check complete: ${rcsCapable} RCS-capable, ${notCapable} not capable out of ${phoneNumbers.length}`);

    const response = {
      success: true,
      data: countOnly ? [] : results,
      summary: {
        total: phoneNumbers.length,
        rcsCapable: rcsCapable,
        notCapable: notCapable,
        apiUsed: apiUsed
      },
    };

    console.log(`[Campaign] API Response Summary:`, response.summary);
    console.log(`========== CAPABILITY CHECK END ==========\n`);

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

// Create campaign entries using insertMany (bulk insert)
export const createCampaignEntries = async (req, res) => {
  try {
    const { campaignId, templateId, phoneNumbers } = req.body;
    const userId = req.user._id;

    if (!campaignId || !templateId) {
      return res.status(400).json({ success: false, message: "campaignId and templateId are required" });
    }

    if (!Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
      return res.status(400).json({ success: false, message: "Phone numbers array is required" });
    }

    console.log(`\n========== CREATE CAMPAIGN ENTRIES START ==========`);

    const template = await Template.findById(templateId).lean();
    if (!template) {
      return res.status(404).json({ success: false, message: "Template not found" });
    }

    const samplePayload = jioRCSService.buildRCSPayload(
      template.templateType,
      template.content,
      {},
      null
    );

    await Campaign.findByIdAndUpdate(campaignId, {
      payload: JSON.stringify(samplePayload),
    });

    const ContactCampaignMessage = (await import("../models/message.model.js")).default;
    const { v4: uuidv4 } = await import("uuid");

    /* ================= CONFIG ================= */
    const CHUNK_SIZE = 1000;
    const CONCURRENCY = 4; // ⭐ safe parallel writes
    /* ========================================== */

    // Split chunks
    const chunks = [];
    for (let i = 0; i < phoneNumbers.length; i += CHUNK_SIZE) {
      chunks.push(phoneNumbers.slice(i, i + CHUNK_SIZE));
    }

    let totalInserted = 0;
    let totalModified = 0;
    let index = 0;

    console.log(`[Campaign] Total chunks: ${chunks.length}`);

    // Worker pool
    const workers = Array(CONCURRENCY).fill(null).map(async () => {
      while (index < chunks.length) {
        const chunkIndex = index++;
        const chunk = chunks[chunkIndex];

        const bulkOps = chunk.map(phone => {
          const cleanPhone = phone.replace(/^\+?91/, "").replace(/\D/g, "");
          return {
            updateOne: {
              filter: { recipientPhoneNumber: cleanPhone, userId },
              update: {
                $setOnInsert: {
                  recipientPhoneNumber: cleanPhone,
                  userId,
                },
                $push: {
                  campaigns: {
                    campaignId,
                    templateId,
                    messageId: uuidv4(),
                    status: "draft",
                    queuedAt: new Date(),
                  },
                },
              },
              upsert: true,
            },
          };
        });

        const result = await ContactCampaignMessage.bulkWrite(bulkOps, {
          ordered: false,
          writeConcern: { w: 1, j: false },
        });

        totalInserted += result.upsertedCount || 0;
        totalModified += result.modifiedCount || 0;

        console.log(
          `[Campaign] Chunk ${chunkIndex + 1}/${chunks.length} done (${chunk.length} contacts)`
        );
      }
    });

    await Promise.all(workers);

    console.log(`[Campaign] ✅ Bulk insert finished`);
    console.log(`========== CREATE CAMPAIGN ENTRIES END ==========\n`);

    res.json({
      success: true,
      message: `Campaign entries created`,
      data: {
        total: phoneNumbers.length,
        inserted: totalInserted,
        modified: totalModified,
      },
    });
  } catch (error) {
    console.error("[Campaign] Create entries error:", error);
    res.status(500).json({ success: false, message: error.message });
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
      status: 'pending',
      recipients: [],
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

    // Wait for sync (cached for 10s)
    await Promise.all(campaigns.map(c => c.syncFromMessages()));

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

    // Sync campaign recipients from messages for accurate status
    await campaign.syncFromMessages();

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
      .select('name description status stats estimatedCost actualCost createdAt completedAt');

    console.log(`[Campaign] Found ${campaigns.length} campaigns for user ${userId}`);

    // Wait for sync (cached for 10s) and collect results
    const syncResults = await Promise.all(campaigns.map(c => c.syncFromMessages()));
    
    // Debug: Log sync results
    console.log('[Campaign] Sync results:', syncResults.map((r, i) => ({
      campaign: campaigns[i].name,
      synced: r.synced,
      stats: campaigns[i].stats
    })));

    // Get ContactCampaignMessage model to aggregate interaction counts
    const ContactCampaignMessage = (await import('../models/message.model.js')).default;

    // Get interaction counts for current page campaigns only
    const campaignIds = campaigns.map(c => c._id);
    console.log('[Campaign] Aggregating interactions for campaign IDs:', campaignIds.map(id => id.toString()));
    
    // Convert userId to ObjectId for proper matching
    const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    
    const interactionStats = await ContactCampaignMessage.aggregate([
      { $match: { userId: userObjectId, 'campaigns.campaignId': { $in: campaignIds } } },
      { $unwind: '$campaigns' },
      { $match: { 'campaigns.campaignId': { $in: campaignIds } } },
      {
        $group: {
          _id: '$campaigns.campaignId',
          totalInteractions: { $sum: '$campaigns.userClickCount' },
          totalReplies: { $sum: '$campaigns.userReplyCount' }
        }
      }
    ]);
    
    console.log('[Campaign] Interaction stats:', interactionStats);

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
      const campaignObj = campaign.toObject();
      const interactions = interactionMap[campaign._id.toString()] || { interactions: 0, replies: 0 };
      
      // Ensure all stats are numbers, not undefined
      const stats = campaignObj.stats || {};
      
      const report = {
        _id: campaignObj._id,
        CampaignName: campaignObj.name,
        type: campaignObj.templateId?.templateType || 'RCS',
        cost: stats.total || 0,
        successCount: stats.sent || 0,
        failedCount: stats.failed || 0,
        totalDelivered: stats.delivered || 0,
        totalRead: stats.read || 0,
        totalReplied: stats.replied || 0,
        userClickCount: interactions.interactions || 0,
        status: campaignObj.status,
        createdAt: campaignObj.createdAt
      };
      
      return report;
    });
    
    console.log('[Campaign] Sample report:', reports[0]);

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
    
    console.log('[Campaign] Response sent with', reports.length, 'campaigns');
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
      .sort({ createdAt: sortOrder });

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
    }

    // Apply user filter
    if (user) {
      allCampaigns = allCampaigns.filter(c => c.userId?.name === user);
    }

    // Apply pagination
    const total = allCampaigns.length;
    const startIndex = (page - 1) * limit;
    const paginatedCampaigns = allCampaigns.slice(startIndex, startIndex + limit);

    // Wait for sync (cached for 10s)
    await Promise.all(paginatedCampaigns.map(c => c.syncFromMessages()));

    // Get universal stats
    const allCampaignsForStats = await Campaign.find({}).select('stats');
    const universalStats = allCampaignsForStats.reduce((acc, campaign) => {
      acc.totalCampaigns += 1;
      acc.totalDelivered += campaign.stats?.sent || 0;
      acc.totalFailed += campaign.stats?.failed || 0;
      return acc;
    }, { totalCampaigns: 0, totalDelivered: 0, totalFailed: 0 });

    const transformedCampaigns = paginatedCampaigns.map(campaign => {
      const campaignObj = campaign.toObject ? campaign.toObject() : campaign;
      return {
        _id: campaignObj._id,
        CampaignName: campaignObj.name,
        type: campaignObj.templateId?.templateType,
        cost: campaignObj.stats?.total || 0,
        successCount: campaignObj.stats?.sent || 0,
        failedCount: campaignObj.stats?.failed || 0,
        status: campaignObj.status,
        createdAt: campaignObj.createdAt,
        userId: campaignObj.userId
      };
    });

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

    const ContactCampaignMessage = (await import('../models/message.model.js')).default;

    // Build aggregation pipeline
    const matchStage = {
      userId: campaign.userId,
      'campaigns.campaignId': campaign._id
    };

    if (search) {
      matchStage.recipientPhoneNumber = { $regex: search, $options: 'i' };
    }

    // Unwind campaigns array and filter by campaignId and status
    const pipeline = [
      { $match: matchStage },
      { $unwind: '$campaigns' },
      { $match: { 'campaigns.campaignId': campaign._id } }
    ];

    if (status && status !== 'all') {
      pipeline.push({ $match: { 'campaigns.status': status } });
    }

    // Get total count
    const countPipeline = [...pipeline, { $count: 'total' }];
    const countResult = await ContactCampaignMessage.aggregate(countPipeline);
    const total = countResult[0]?.total || 0;

    // Get paginated results
    pipeline.push(
      { $sort: { createdAt: -1 } },
      { $skip: (page - 1) * limit },
      { $limit: limit },
      {
        $project: {
          _id: '$campaigns._id',
          phoneNumber: '$recipientPhoneNumber',
          status: '$campaigns.status',
          templateType: { $literal: 'RCS' },
          sentAt: '$campaigns.sentAt',
          deliveredAt: '$campaigns.deliveredAt',
          readAt: '$campaigns.readAt',
          clickedAt: '$campaigns.clickedAt',
          clickedAction: '$campaigns.clickedAction',
          userText: '$campaigns.userText',
          suggestionResponse: '$campaigns.suggestionResponse',
          interactions: '$campaigns.userClickCount',
          replies: '$campaigns.userReplyCount',
          errorMessage: '$campaigns.errorMessage',
          errorCode: '$campaigns.errorCode',
          createdAt: '$createdAt'
        }
      }
    );

    const messages = await ContactCampaignMessage.aggregate(pipeline);

    res.json({
      success: true,
      data: messages,
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

    const ContactCampaignMessage = (await import('../models/message.model.js')).default;

    const messages = await ContactCampaignMessage.aggregate([
      { $match: { userId: campaign.userId, 'campaigns.campaignId': campaign._id } },
      { $unwind: '$campaigns' },
      { $match: { 'campaigns.campaignId': campaign._id } },
      { $sort: { createdAt: -1 } },
      {
        $project: {
          _id: '$campaigns._id',
          phoneNumber: '$recipientPhoneNumber',
          status: '$campaigns.status',
          templateType: { $literal: 'RCS' },
          sentAt: '$campaigns.sentAt',
          deliveredAt: '$campaigns.deliveredAt',
          readAt: '$campaigns.readAt',
          clickedAt: '$campaigns.clickedAt',
          clickedAction: '$campaigns.clickedAction',
          userText: '$campaigns.userText',
          suggestionResponse: '$campaigns.suggestionResponse',
          interactions: '$campaigns.userClickCount',
          replies: '$campaigns.userReplyCount',
          errorMessage: '$campaigns.errorMessage',
          errorCode: '$campaigns.errorCode',
          createdAt: '$createdAt'
        }
      }
    ]);

    res.json({
      success: true,
      data: messages,
      total: messages.length
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
