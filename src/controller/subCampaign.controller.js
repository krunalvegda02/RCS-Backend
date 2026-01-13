import Campaign from '../models/campaign.model.js';
import Template from '../models/template.model.js';
import ContactCampaignMessage from '../models/contact_campaign_message.model.js';
import { sendBatchEntriesToKafka } from '../services/kafka.service.js';

// Create master campaign with 30 sub-campaigns
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

    // Calculate sub-campaign size to create exactly 30 sub-campaigns
    const subCampaignSize = Math.ceil(phoneNumbers.length / 30);
    
    // Create master campaign
    const masterCampaign = await Campaign.create({
      name,
      userId,
      templateId,
      isMaster: true,
      status: 'pending',
      payload: JSON.stringify(template.generatePayload()),
      stats: {
        total: phoneNumbers.length,
        pending: phoneNumbers.length,
        sent: 0,
        delivered: 0,
        failed: 0
      }
    });

    // Split contacts into exactly 30 sub-campaigns
    const chunks = [];
    for (let i = 0; i < phoneNumbers.length; i += subCampaignSize) {
      chunks.push(phoneNumbers.slice(i, i + subCampaignSize));
    }

    console.log(`[SubCampaign] Creating ${chunks.length} sub-campaigns for ${phoneNumbers.length} contacts`);

    // Create sub-campaigns in parallel
    const subCampaignPromises = chunks.map(async (chunk, index) => {
      return Campaign.create({
        name: `bot${index + 1}`,
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

    // Send batch entries to Kafka for fast processing
    const batchData = {
        templateId: templateId.toString(),
      userId: userId.toString(),
      totalContacts: phoneNumbers.length,
      subCampaigns: createdSubCampaigns.map((subCampaign, index) => ({
        campaignId: subCampaign._id.toString(),
        phoneNumbers: chunks[index]
      }))
    };

    // Send to Kafka for async processing
    const kafkaResult = await sendBatchEntriesToKafka(batchData);
    
    if (!kafkaResult.success) {
      console.error('[SubCampaign] Kafka send failed, falling back to direct processing');
      
      // Fallback: Direct processing if Kafka fails
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
    }

    console.log(`[SubCampaign] ✅ Created master campaign with ${createdSubCampaigns.length} sub-campaigns`);
    console.log(`[SubCampaign] ✅ Batch entries sent to Kafka for processing`);

    res.json({
      success: true,
      message: `Master campaign created with ${createdSubCampaigns.length} sub-campaigns. Batch entries processing via Kafka.`,
      data: {
        masterCampaign,
        subCampaignsCount: createdSubCampaigns.length,
        totalContacts: phoneNumbers.length,
        processingMethod: kafkaResult.success ? 'kafka' : 'direct'
      }
    });
  } catch (error) {
    console.error('[SubCampaign] Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};