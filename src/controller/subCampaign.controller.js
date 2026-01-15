import Campaign from '../models/campaign.model.js';
import Template from '../models/template.model.js';
import { sendBatchEntriesToKafka } from '../services/kafka.service.js';

export const updateCampaignStatus = async (req, res) => {
  try {
    const { campaignId } = req.body;
    const userId = req.user._id;

    const campaign = await Campaign.findOne({ _id: campaignId, userId });
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    campaign.status = 'pending';
    await campaign.save();

    console.log(`[Campaign] Status updated to pending for campaign ${campaignId}`);

    res.json({
      success: true,
      message: 'Campaign status updated to pending',
      data: { campaignId, status: 'pending' }
    });
  } catch (error) {
    console.error('[Campaign] Update status error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createMasterCampaign = async (req, res) => {
  try {
    const { name, templateId, phoneNumbers } = req.body;
    const userId = req.user._id;

    if (!phoneNumbers || phoneNumbers.length === 0) {
      return res.status(400).json({ success: false, message: 'Phone numbers required' });
    }

    const template = await Template.findById(templateId);
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    const botId = await Campaign.findAvailableBot();
    
    const campaign = await Campaign.create({
      name,
      userId,
      templateId,
      botId,
      status: 'draft', // Start as draft, will change to pending after bulk entries
      payload: JSON.stringify(template.generatePayload()),
      stats: {
        total: phoneNumbers.length,
        pending: phoneNumbers.length,
        sent: 0,
        delivered: 0,
        failed: 0
      }
    });

    // Send to Kafka for fast bulk processing
    const kafkaResult = await sendBatchEntriesToKafka({
      campaignId: campaign._id,
      templateId,
      userId,
      phoneNumbers
    });
    
    if (!kafkaResult.success) {
      console.error('[Campaign] Kafka send failed, falling back to direct processing');
      
      // Fallback: Direct processing
      const { v4: uuidv4 } = await import('uuid');
      const ContactCampaignMessage = (await import('../models/contact_campaign_message.model.js')).default;
      
      const bulkOps = phoneNumbers.map(phone => {
        const cleanPhone = phone.replace(/^\+?91/, '').replace(/\D/g, '');
        return {
          updateOne: {
            filter: { recipientPhoneNumber: cleanPhone, userId },
            update: {
              $setOnInsert: { recipientPhoneNumber: cleanPhone, userId },
              $addToSet: { 
                campaigns: {
                  campaignId: campaign._id,
                  templateId,
                  messageId: uuidv4(),
                  status: 'draft',
                  queuedAt: new Date()
                },
                campaignIds: campaign._id
              }
            },
            upsert: true
          }
        };
      });

      await ContactCampaignMessage.bulkWrite(bulkOps, { ordered: false });
      await Campaign.findByIdAndUpdate(campaign._id, { status: 'pending' });
    }

    // Note: Status remains 'draft' when using Kafka
    // Consumer will update to 'pending' after processing completes

    console.log(`[Campaign] ✅ Created campaign with ${phoneNumbers.length} contacts on ${botId}`);

    res.json({
      success: true,
      message: `Campaign created successfully on ${botId}`,
      data: {
        masterCampaign: campaign,
        subCampaignsCount: 1,
        totalContacts: phoneNumbers.length,
        botId,
        processingMethod: kafkaResult.success ? 'kafka' : 'direct'
      }
    });
  } catch (error) {
    console.error('[Campaign] Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};