import Campaign from '../models/campaign.model.js';
import Template from '../models/template.model.js';
import ContactCampaignMessage from '../models/contact_campaign_message.model.js';
import jioRCSService from '../services/JioRCS.service.js'; // Still needed for capability check
import mongoose from 'mongoose';
import pLimit from "p-limit";

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
    const { campaignId, templateId, phoneNumbers, createSubCampaigns = false, subCampaignSize = 200 } = req.body;
    const userId = req.user?._id;

    console.log('[Campaign] createCampaignEntries request:', {
      campaignId,
      templateId,
      phoneNumbersCount: phoneNumbers?.length,
      userId,
      hasUser: !!req.user,
      createSubCampaigns,
      subCampaignSize
    });

    if (!userId) {
      return res.status(401).json({ success: false, message: "User not authenticated" });
    }

    if (!campaignId || !templateId) {
      return res.status(400).json({ success: false, message: "campaignId and templateId are required" });
    }

    if (!Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
      return res.status(400).json({ success: false, message: "Phone numbers array is required" });
    }

    console.log(`[Campaign] Creating entries for ${phoneNumbers.length} contacts`);
    console.time("CampaignInsert");

    const { v4: uuidv4 } = await import("uuid");

    const CHUNK_SIZE = 1000;
    const CONCURRENCY = 3;
    const chunks = [];
    for (let i = 0; i < phoneNumbers.length; i += CHUNK_SIZE) {
      chunks.push(phoneNumbers.slice(i, i + CHUNK_SIZE));
    }

    console.log(`[Campaign] Processing ${chunks.length} chunks`);

    const limit = pLimit(CONCURRENCY);
    let totalInserted = 0;
    let totalModified = 0;

    const executeBulkWithRetry = async (bulkOps, retries = 3) => {
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          return await ContactCampaignMessage.bulkWrite(bulkOps, {
            ordered: false,
            writeConcern: { w: 1, j: false },
          });
        } catch (error) {
          if (attempt === retries || !error.message.includes('SSL') && !error.message.includes('ECONNRESET')) {
            throw error;
          }
          console.log(`[Campaign] Retry ${attempt}/${retries} after connection error`);
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    };

    await Promise.all(
      chunks.map((chunk, idx) =>
        limit(async () => {
          const bulkOps = chunk.map(phone => {
            const cleanPhone = phone.replace(/^\+?91/, "").replace(/\D/g, "");
            return {
              updateOne: {
                filter: { recipientPhoneNumber: cleanPhone, userId },
                update: {
                  $setOnInsert: { recipientPhoneNumber: cleanPhone, userId },
                  $push: {
                    campaigns: {
                      campaignId,
                      templateId,
                      messageId: uuidv4(),
                      status: "pending",
                      queuedAt: new Date(),
                    },
                  },
                  $addToSet: { campaignIds: campaignId },
                },
                upsert: true,
              },
            };
          });

          const result = await executeBulkWithRetry(bulkOps);

          totalInserted += result.upsertedCount || 0;
          totalModified += result.modifiedCount || 0;
          console.log(`[Campaign] Chunk ${idx + 1}/${chunks.length} completed`);
        })
      )
    );

    // Set campaign status to pending (ready for Python bot)
    await Campaign.findByIdAndUpdate(campaignId, {
      status: "pending",
      stats: {
        total: phoneNumbers.length,
        pending: phoneNumbers.length,
        sent: 0,
        delivered: 0,
        failed: 0
      }
    });

    console.timeEnd("CampaignInsert");
    console.log(`[Campaign] ✅ Entries created: ${totalInserted} inserted, ${totalModified} modified`);
    console.log(`[Campaign] ✅ Campaign set to pending status for Python bot processing`);

    res.json({
      success: true,
      message: "Campaign entries created and ready for processing",
      data: {
        total: phoneNumbers.length,
        inserted: totalInserted,
        modified: totalModified,
        status: "pending"
      },
    });
  } catch (error) {
    console.error("[Campaign] Create entries error:", error);
    await Campaign.findByIdAndUpdate(req.body.campaignId, { status: "failed" }).catch(console.error);
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
      status: 'draft', // Always start as draft
      payload: JSON.stringify(template.generatePayload()),
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
      message: 'Campaign created successfully (ready for Python bot)',
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
    const { name, description, templateId, recipients, campaignId, batchSize, autoStart = true } = req.body;
    const userId = req.user._id;

    console.log(`[Campaign] Bulk send request received:`);
    console.log(`[Campaign] - name: ${name}`);
    console.log(`[Campaign] - templateId: ${templateId}`);
    console.log(`[Campaign] - campaignId: ${campaignId}`);

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

        estimatedCost: actualCost,
        actualCost: 0,
        blockedAmount: 0,
      });
      console.log(`[Campaign] Created new campaign ${campaign._id}`);
    }

    // Block wallet balance for this campaign
    if (autoStart && actualCost > 0) {
      await req.user.blockBalanceForCampaign(actualCost, campaign._id);
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

      // Python bot will handle message processing
      console.log(`[Campaign] Campaign created and ready for Python bot processing`);
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

    // Only show master campaigns or standalone campaigns (not sub-campaigns)
    let query = {
      userId,
      $or: [
        { isMaster: true },
        { isMaster: { $exists: false } },
        { masterCampaignId: { $exists: false } }
      ]
    };
    if (status) query.status = status;

    const campaigns = await Campaign.find(query)
      .populate('templateId', 'name templateType')
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip((page - 1) * limit);

    // Sync stats for master campaigns
    await Promise.all(campaigns.map(async (c) => {
      if (c.isMaster) {
        console.log(`[Campaign] Syncing stats for master campaign: ${c.name}`);
        await c.syncMasterStats();
      }
      return Promise.resolve();
    }));

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

    // Sync stats - if master, sync from sub-campaigns
    if (campaign.isMaster) {
      await campaign.syncMasterStats();
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

// Start campaign (for Python bot to pick up)
export const start = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const campaign = await Campaign.findOneAndUpdate(
      { _id: id, userId, status: { $in: ['draft', 'pending'] } },
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

    console.log(`[Campaign] Campaign ${id} marked as running for Python bot`);

    res.json({
      success: true,
      message: 'Campaign started - Python bot will process messages',
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

// Restart campaign processing (for Python bot)
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

    // Reset campaign to running status for Python bot
    campaign.status = 'running';
    campaign.startedAt = new Date();
    await campaign.save();

    console.log(`[Campaign] Campaign ${id} restarted for Python bot processing`);

    res.json({
      success: true,
      message: 'Campaign restarted - Python bot will process messages',
      data: { campaignId: id, status: 'running' }
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

    // Sync stats - if master, sync from sub-campaigns
    if (campaign.isMaster) {
      await campaign.syncMasterStats();
    }

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

    // Build query - only show master campaigns or standalone campaigns (hide sub-campaigns)
    let query = {
      userId,
      $or: [
        { isMaster: true },
        { isMaster: { $exists: false } },
        { masterCampaignId: { $exists: false } }
      ]
    };

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

    // Get paginated campaigns with lean() for faster queries
    const campaigns = await Campaign.find(query)
      .populate('templateId', 'name templateType')
      .sort({ createdAt: sortOrder })
      .limit(limit)
      .skip((page - 1) * limit)
      .select('name description status stats estimatedCost actualCost createdAt completedAt isMaster masterCampaignId');

    // Sync master campaign stats BEFORE converting to lean
    await Promise.all(campaigns.map(async (c) => {
      if (c.isMaster) {
        console.log(`[Campaign] Syncing master campaign stats for: ${c.name}`);
        await c.syncMasterStats();
      }
      return Promise.resolve();
    }));

    // Convert to plain objects after syncing
    const campaignsLean = campaigns.map(c => c.toObject ? c.toObject() : c);

    console.log(`[Campaign] Found ${campaignsLean.length} campaigns for user ${userId}`);

    // Get ContactCampaignMessage model to aggregate interaction counts

    // Optimized: Use campaign.stats directly instead of aggregating ContactCampaignMessage
    // This avoids the expensive $unwind on heavy documents
    const reports = campaignsLean.map(campaign => {
      const stats = campaign.stats || {
        total: 0,
        sent: 0,
        delivered: 0,
        read: 0,
        replied: 0,
        failed: 0
      };

      return {
        _id: campaign._id,
        CampaignName: campaign.name,
        type: campaign.templateId?.templateType || 'RCS',
        cost: campaign.stats?.total || 0,
        successCount: stats.sent,
        failedCount: stats.failed,
        totalDelivered: stats.delivered,
        totalRead: stats.read,
        totalReplied: stats.replied,
        userClickCount: 0, // Clicks not stored on campaign stats yet, performance tradeoff
        status: campaign.status,
        createdAt: campaign.createdAt,
        isMaster: campaign.isMaster || false
      };
    });

    console.log('[Campaign] Sample report with recipients:', reports[0]);

    // Calculate aggregate stats for all campaigns (not just current page) - exclude archived
    const userObjectIdForStats = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

    // Optimized: Aggregate stats from Campaign collection
    const sentStats = await Campaign.aggregate([
      { $match: { userId: userObjectIdForStats } },
      {
        $group: {
          _id: null,
          totalMessages: { $sum: '$stats.total' },  // All messages
          totalDelivered: { $sum: '$stats.delivered' },
          totalFailed: { $sum: '$stats.failed' }
        }
      }
    ]);

    const aggregateStats = sentStats[0] || { totalMessages: 0, totalDelivered: 0, totalFailed: 0 };
    // totalSent = all messages that are not draft (calculated as delivered + failed + everything else that was sent)
    // totalExpired = total - delivered - failed (messages that didn't get a final status)
    const totalSent = aggregateStats.totalMessages; // All messages created
    const totalExpired = Math.max(0, aggregateStats.totalMessages - aggregateStats.totalDelivered - aggregateStats.totalFailed);

    res.json({
      success: true,
      data: reports,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
        totalSent,
        totalDelivered: aggregateStats.totalDelivered,
        totalFailed: aggregateStats.totalFailed,
        totalExpired
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
    let { status, type, user, search, sort = 'newest', startDate, endDate } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    if (Array.isArray(search)) {
      search = search[0];
    }

    // Only show master campaigns or standalone campaigns (hide sub-campaigns)
    let query = {
      $or: [
        { isMaster: true },
        { isMaster: { $exists: false } },
        { masterCampaignId: { $exists: false } }
      ]
    };
    if (status) query.status = status;

    // Date range filter
    if (startDate && endDate) {
      query.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    let templateIds = [];
    if (type) {
      const Template = (await import('../models/template.model.js')).default;
      const matchingTemplates = await Template.find({ templateType: type }).select('_id');
      templateIds = matchingTemplates.map(t => t._id);
      if (templateIds.length > 0) {
        query.templateId = { $in: templateIds };
      } else {
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

    // Sync master campaign stats before returning
    await Promise.all(
      paginatedCampaigns.map(async (c) => {
        if (c.isMaster) {
          console.log(`[Campaign] Admin syncing stats for master campaign: ${c.name}`);
          await c.syncMasterStats();
        }
        return Promise.resolve();
      })
    );

    // Get available campaign IDs (Master + Standalone)
    const campaignIds = paginatedCampaigns.map(c => c._id);

    // For Master Campaigns, we need to find their Sub-Campaigns to aggregate stats correctly
    const masterCampaignIds = paginatedCampaigns.filter(c => c.isMaster).map(c => c._id);
    const subCampaignMap = {}; // MasterID -> [SubID1, SubID2...]
    let allCampaignIdsForAgg = [...campaignIds];

    if (masterCampaignIds.length > 0) {
      // Import Campaign model if not available (though it should be locally available as 'Campaign' usually or via mongoose)
      // Assuming 'Campaign' variable from line 936 is available or we use mongoose.model
      const SubCampaignModel = mongoose.model('Campaign');
      const subCampaigns = await SubCampaignModel.find({ masterCampaignId: { $in: masterCampaignIds } }).select('_id masterCampaignId');

      subCampaigns.forEach(sub => {
        const masterIdStr = sub.masterCampaignId.toString();
        if (!subCampaignMap[masterIdStr]) subCampaignMap[masterIdStr] = [];
        subCampaignMap[masterIdStr].push(sub._id.toString());
        allCampaignIdsForAgg.push(sub._id);
      });
    }

    // Aggregate stats for ALL relevant campaigns (Masters, Standalone, AND Sub-Campaigns)
    const campaignStatsAgg = await ContactCampaignMessage.aggregate([
      { $match: { 'campaigns.campaignId': { $in: allCampaignIdsForAgg } } },
      { $unwind: '$campaigns' },
      { $match: { 'campaigns.campaignId': { $in: allCampaignIdsForAgg } } },
      {
        $group: {
          _id: '$campaigns.campaignId',
          totalDelivered: { $sum: { $cond: [{ $in: ['$campaigns.status', ['delivered', 'read', 'replied']] }, 1, 0] } },
          totalFailed: { $sum: { $cond: [{ $eq: ['$campaigns.status', 'failed'] }, 1, 0] } },
          totalExpired: { $sum: { $cond: [{ $eq: ['$campaigns.status', 'expired'] }, 1, 0] } }
        }
      }
    ]);

    // Create stats map
    const statsMap = {};
    campaignStatsAgg.forEach(stat => {
      statsMap[stat._id.toString()] = {
        totalDelivered: stat.totalDelivered || 0,
        totalFailed: stat.totalFailed || 0,
        totalExpired: stat.totalExpired || 0
      };
    });

    // Get universal stats by aggregating from ContactCampaignMessage
    const universalStatsResult = await ContactCampaignMessage.aggregate([
      { $unwind: '$campaigns' },
      {
        $group: {
          _id: null,
          totalSent: { $sum: { $cond: [{ $in: ['$campaigns.status', ['sent', 'delivered', 'read', 'replied', 'failed']] }, 1, 0] } },
          totalDelivered: { $sum: { $cond: [{ $in: ['$campaigns.status', ['delivered', 'read', 'replied']] }, 1, 0] } },
          totalFailed: { $sum: { $cond: [{ $eq: ['$campaigns.status', 'failed'] }, 1, 0] } },
          totalExpired: { $sum: { $cond: [{ $eq: ['$campaigns.status', 'expired'] }, 1, 0] } }
        }
      }
    ]);

    const universalStats = universalStatsResult[0] || { totalSent: 0, totalDelivered: 0, totalFailed: 0, totalExpired: 0 };
    universalStats.totalCampaigns = total;

    const transformedCampaigns = paginatedCampaigns.map(campaign => {
      const campaignObj = campaign.toObject ? campaign.toObject() : campaign;
      const campaignIdStr = campaignObj._id.toString();

      let stats = { totalDelivered: 0, totalFailed: 0, totalExpired: 0 };

      // If Master Campaign, sum up Sub-Campaign stats
      if (campaignObj.isMaster && subCampaignMap[campaignIdStr]) {
        subCampaignMap[campaignIdStr].forEach(subId => {
          const subStats = statsMap[subId] || { totalDelivered: 0, totalFailed: 0, totalExpired: 0 };
          stats.totalDelivered += subStats.totalDelivered;
          stats.totalFailed += subStats.totalFailed;
          stats.totalExpired += subStats.totalExpired;
        });
      } else {
        // Standalone or direct match
        stats = statsMap[campaignIdStr] || stats;
      }

      return {
        _id: campaignObj._id,
        CampaignName: campaignObj.name,
        type: campaignObj.templateId?.templateType,
        cost: campaignObj.stats?.total || 0,
        successCount: campaignObj.stats?.sent || 0,
        failedCount: stats.totalFailed,
        expiredCount: stats.totalExpired,
        totalDelivered: stats.totalDelivered,
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

// Get campaign messages - OPTIMIZED for large datasets
export const getCampaignMessages = async (req, res) => {
  try {
    const { id } = req.params;
    const { search, status } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50); // Cap at 50

    // Lightweight campaign lookup
    const campaign = await Campaign.findById(id).select('_id userId isMaster').lean();
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    // Get sub-campaign IDs if master
    let campaignIds = [campaign._id];
    if (campaign.isMaster) {
      const subCampaigns = await Campaign.find({ masterCampaignId: campaign._id }).select('_id').lean();
      campaignIds = [...campaignIds, ...subCampaigns.map(s => s._id)];
    }

    // Build lightweight match stage
    // Build lightweight match stage with $elemMatch to ensure exact match on array item
    const matchStage = {
      userId: campaign.userId,
      campaigns: {
        $elemMatch: {
          campaignId: { $in: campaignIds }
        }
      }
    };

    if (status && status !== 'all') {
      matchStage.campaigns.$elemMatch.status = status;
    }

    if (search) {
      matchStage.recipientPhoneNumber = { $regex: search, $options: 'i' };
    }



    // Optimized count: Use countDocuments which leverages the index directly
    const total = await ContactCampaignMessage.countDocuments(matchStage).maxTimeMS(60000);

    // Optimized Data Query: Use find() instead of aggregate() for maximum speed
    // Use select() to fetch only necessary fields and campaigns.$ to get the matching campaign entry
    const docs = await ContactCampaignMessage.find(matchStage)
      .select({
        recipientPhoneNumber: 1,
        'campaigns.$': 1 // Project ONLY the first matching campaign element
      })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean()
      .maxTimeMS(60000);

    // Map the results to the expected format
    const messages = docs.map(doc => {
      const camp = doc.campaigns?.[0] || {};
      return {
        _id: camp._id,
        phoneNumber: doc.recipientPhoneNumber,
        status: camp.status,
        sentAt: camp.sentAt,
        deliveredAt: camp.deliveredAt,
        readAt: camp.readAt,
        failedAt: camp.failedAt,
        errorCode: camp.errorCode
      };
    });

    res.json({
      success: true,
      data: messages,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    console.error('[Campaign] Get messages error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Admin: Get ALL campaign messages for export (no pagination)
export const getAllCampaignMessagesForExport = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const userId = req.user._id;
    const isAdmin = req.user.role === 'admin' || req.user.role === 'ADMIN';

    console.log('[Campaign] Export messages request:', { campaignId, userId, isAdmin, userRole: req.user.role });

    // Admin can access any campaign, regular users only their own
    let campaign;
    if (isAdmin) {
      campaign = await Campaign.findById(campaignId).select('_id userId isMaster masterCampaignId').lean();
      console.log('[Campaign] Admin looking for campaign:', campaignId, 'Found:', !!campaign);
    } else {
      campaign = await Campaign.findOne({ _id: campaignId, userId }).select('_id userId isMaster masterCampaignId').lean();
      console.log('[Campaign] User looking for campaign:', campaignId, 'userId:', userId, 'Found:', !!campaign);
    }

    if (!campaign) {
      console.log('[Campaign] Campaign not found');
      return res.status(404).json({
        success: false,
        message: 'Campaign not found',
      });
    }


    // If master campaign, get messages from all sub-campaigns
    let campaignIds = [campaign._id];
    if (campaign.isMaster) {
      const subCampaigns = await Campaign.find({ masterCampaignId: campaign._id }).select('_id').lean();
      campaignIds = [...campaignIds, ...subCampaigns.map(s => s._id)];
    }

    // Optimized aggregation with index hints and limited projection
    const messages = await ContactCampaignMessage.aggregate([
      {
        $match: {
          userId: campaign.userId,
          'campaigns.campaignId': { $in: campaignIds }
        }
      },
      { $unwind: '$campaigns' },
      { $match: { 'campaigns.campaignId': { $in: campaignIds } } },
      {
        $project: {
          _id: 0,
          phoneNumber: '$recipientPhoneNumber',
          status: '$campaigns.status',
          templateType: { $literal: 'RCS' },
          sentAt: '$campaigns.sentAt',
          deliveredAt: '$campaigns.deliveredAt',
          readAt: '$campaigns.readAt',
          clickedAction: '$campaigns.clickedAction',
          userText: '$campaigns.userText',
          suggestionResponse: '$campaigns.suggestionResponse',
          interactions: '$campaigns.userClickCount',
          replies: '$campaigns.userReplyCount',
          errorMessage: '$campaigns.errorMessage',
          errorCode: '$campaigns.errorCode'
        }
      }
    ]).allowDiskUse(true);

    console.log('[Campaign] Found', messages.length, 'messages');

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
    let { status, type, user, search, sort = 'newest', startDate, endDate } = req.query;
    const requestUserId = req.user._id;
    const isAdmin = req.user.role === 'admin' || req.user.role === 'ADMIN';
    const { userId } = req.params;

    if (Array.isArray(search)) {
      search = search[0];
    }

    // Only show master campaigns or standalone campaigns (hide sub-campaigns)
    let query = {
      $or: [
        { isMaster: true },
        { isMaster: { $exists: false } },
        { masterCampaignId: { $exists: false } }
      ]
    };

    // If not admin or userId is provided, filter by userId
    if (!isAdmin) {
      query.userId = requestUserId;
    } else if (userId && userId !== 'all') {
      query.userId = userId;
    }
    // If admin and no userId or userId is 'all', don't filter by userId (get all campaigns)

    if (status) query.status = status;

    // Date range filter
    if (startDate && endDate) {
      query.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    if (type) {
      const Template = (await import('../models/template.model.js')).default;
      const matchingTemplates = await Template.find({ templateType: type }).select('_id');
      const templateIds = matchingTemplates.map(t => t._id);
      if (templateIds.length > 0) {
        query.templateId = { $in: templateIds };
      } else {
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

    // Filter by user name if provided (admin only)
    if (isAdmin && user) {
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
      totalDelivered: campaign.stats?.delivered || 0,
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

// Complete campaign and settle wallet
export const completeCampaign = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const campaign = await Campaign.findOne({ _id: id, userId });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }

    if (campaign.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Campaign already completed'
      });
    }

    // Complete campaign and settle wallet
    const result = await campaign.completeCampaign();

    res.json({
      success: true,
      message: 'Campaign completed and wallet settled',
      data: {
        campaignId: campaign._id,
        status: 'completed',
        actualCost: result.actualCost,
        refundAmount: result.refundAmount,
        delivered: result.delivered,
        failed: result.failed
      }
    });
  } catch (error) {
    console.error('[Campaign] Complete campaign error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
