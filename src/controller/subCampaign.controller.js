import Campaign from '../models/campaign.model.js';
import Template from '../models/template.model.js';

// Create master campaign with sub-campaigns
export const createMasterCampaign = async (req, res) => {
  try {
    const { name, templateId, phoneNumbers, subCampaignSize = 200 } = req.body;
    const userId = req.user._id;

    if (!phoneNumbers || phoneNumbers.length === 0) {
      return res.status(400).json({ success: false, message: 'Phone numbers required' });
    }

    const template = await Template.findById(templateId);
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    // Create master campaign
    const masterCampaign = await Campaign.create({
      name,
      userId,
      templateId,
      isMaster: true,
      status: 'processing',
      payload: JSON.stringify(template.generatePayload()),
      stats: {
        total: phoneNumbers.length,
        pending: phoneNumbers.length,
        sent: 0,
        delivered: 0,
        failed: 0
      }
    });

    // Split contacts into sub-campaigns
    const subCampaigns = [];
    const chunks = [];
    for (let i = 0; i < phoneNumbers.length; i += subCampaignSize) {
      chunks.push(phoneNumbers.slice(i, i + subCampaignSize));
    }

    console.log(`[SubCampaign] Creating ${chunks.length} sub-campaigns for ${phoneNumbers.length} contacts`);

    // Create sub-campaigns in parallel
    const subCampaignPromises = chunks.map(async (chunk, index) => {
      return Campaign.create({
        name: `${name} - Part ${index + 1}`,
        userId,
        templateId,
        isMaster: false,
        masterCampaignId: masterCampaign._id,
        subCampaignIndex: index,
        status: 'pending',
        payload: JSON.stringify(template.generatePayload()),
        stats: {
          total: chunk.length,
          pending: chunk.length,
          sent: 0,
          delivered: 0,
          failed: 0
        }
      });
    });

    const createdSubCampaigns = await Promise.all(subCampaignPromises);

    // Create entries for each sub-campaign in parallel
    const ContactCampaignMessage = (await import('../models/message.model.js')).default;
    const { v4: uuidv4 } = await import('uuid');

    await Promise.all(
      createdSubCampaigns.map(async (subCampaign, index) => {
        const chunk = chunks[index];
        const bulkOps = chunk.map(phone => {
          const cleanPhone = phone.replace(/^\+?91/, '').replace(/\D/g, '');
          return {
            updateOne: {
              filter: { recipientPhoneNumber: cleanPhone, userId },
              update: {
                $setOnInsert: { recipientPhoneNumber: cleanPhone, userId },
                $push: {
                  campaigns: {
                    campaignId: subCampaign._id,
                    templateId,
                    messageId: uuidv4(),
                    status: 'draft',
                    queuedAt: new Date()
                  }
                },
                $addToSet: { campaignIds: subCampaign._id }
              },
              upsert: true
            }
          };
        });

        await ContactCampaignMessage.bulkWrite(bulkOps, { ordered: false });
      })
    );

    res.json({
      success: true,
      message: `Master campaign created with ${createdSubCampaigns.length} sub-campaigns`,
      data: {
        masterCampaign,
        subCampaignsCount: createdSubCampaigns.length,
        totalContacts: phoneNumbers.length
      }
    });
  } catch (error) {
    console.error('[SubCampaign] Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get master campaign with sub-campaigns stats
export const getMasterCampaignStats = async (req, res) => {
  try {
    const { masterCampaignId } = req.params;
    const userId = req.user._id;

    const masterCampaign = await Campaign.findOne({ _id: masterCampaignId, userId, isMaster: true });
    if (!masterCampaign) {
      return res.status(404).json({ success: false, message: 'Master campaign not found' });
    }

    // Get all sub-campaigns
    const subCampaigns = await Campaign.find({ masterCampaignId, isMaster: false }).lean();

    // Aggregate stats from sub-campaigns
    const ContactCampaignMessage = (await import('../models/message.model.js')).default;
    const subCampaignIds = subCampaigns.map(sc => sc._id);

    const aggregatedStats = await ContactCampaignMessage.aggregate([
      { $match: { userId, 'campaigns.campaignId': { $in: subCampaignIds } } },
      { $unwind: '$campaigns' },
      { $match: { 'campaigns.campaignId': { $in: subCampaignIds } } },
      {
        $group: {
          _id: '$campaigns.status',
          count: { $sum: 1 }
        }
      }
    ]);

    const stats = {
      total: 0,
      sent: 0,
      delivered: 0,
      failed: 0,
      pending: 0
    };

    aggregatedStats.forEach(stat => {
      stats.total += stat.count;
      if (['sent', 'delivered', 'read', 'replied'].includes(stat._id)) stats.sent += stat.count;
      if (['delivered', 'read', 'replied'].includes(stat._id)) stats.delivered += stat.count;
      if (stat._id === 'failed') stats.failed += stat.count;
      if (['draft', 'queued', 'pending'].includes(stat._id)) stats.pending += stat.count;
    });

    res.json({
      success: true,
      data: {
        masterCampaign,
        subCampaignsCount: subCampaigns.length,
        stats
      }
    });
  } catch (error) {
    console.error('[SubCampaign] Stats error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Start all sub-campaigns in parallel
export const startMasterCampaign = async (req, res) => {
  try {
    const { masterCampaignId } = req.params;
    const userId = req.user._id;

    const masterCampaign = await Campaign.findOne({ _id: masterCampaignId, userId, isMaster: true });
    if (!masterCampaign) {
      return res.status(404).json({ success: false, message: 'Master campaign not found' });
    }

    // Update all sub-campaigns to processing
    await Campaign.updateMany(
      { masterCampaignId, isMaster: false },
      { status: 'processing' }
    );

    // Update master campaign
    masterCampaign.status = 'processing';
    await masterCampaign.save();

    // Start processing sub-campaigns in parallel
    const jioRCSService = (await import('../services/JioRCS.service.js')).default;
    const subCampaigns = await Campaign.find({ masterCampaignId, isMaster: false });

    setImmediate(() => {
      Promise.all(
        subCampaigns.map(sc => 
          jioRCSService.processCampaignBatch(sc._id, 100, 500).catch(console.error)
        )
      );
    });

    res.json({
      success: true,
      message: `Started ${subCampaigns.length} sub-campaigns in parallel`,
      data: { subCampaignsCount: subCampaigns.length }
    });
  } catch (error) {
    console.error('[SubCampaign] Start error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
