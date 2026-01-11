import ContactCampaignMessage from '../models/message.model.js';
import Template from '../models/template.model.js';
import Campaign from '../models/campaign.model.js';
import { sendMessageToKafka } from './kafka.service.js';
import pLimit from 'p-limit';

export async function sendCampaignMessages(campaignId, userId) {
  try {
    console.log(`[CampaignSender] Starting to send messages for campaign ${campaignId}`);
    const startTime = Date.now();
    
    // Get campaign and template ONCE
    const campaign = await Campaign.findById(campaignId).populate('templateId');
    if (!campaign || !campaign.templateId) {
      throw new Error('Campaign or template not found');
    }
    
    // If master campaign, get all sub-campaign IDs
    let campaignIds = [campaignId];
    if (campaign.isMaster) {
      const subCampaigns = await Campaign.find({ masterCampaignId: campaignId }).select('_id').lean();
      campaignIds = subCampaigns.map(s => s._id);
      console.log(`[CampaignSender] Master campaign detected, sending for ${campaignIds.length} sub-campaigns`);
    }
    
    const template = campaign.templateId;
    const templatePayload = template.generatePayload();
    
    // Check total draft messages first (across all sub-campaigns if master)
    const totalDraft = await ContactCampaignMessage.countDocuments({
      userId,
      campaignIds: { $in: campaignIds },
      'campaigns.campaignId': { $in: campaignIds },
      'campaigns.status': 'draft'
    });
    
    console.log(`[CampaignSender] Found ${totalDraft} draft messages to send`);
    
    if (totalDraft === 0) {
      console.log(`[CampaignSender] ⚠️ No draft messages found for campaign ${campaignId}`);
      return { sent: 0, duration: 0, rate: 0 };
    }
    
    // Get all draft messages in batches (across all sub-campaigns if master)
    const BATCH_SIZE = 5000;
    let skip = 0;
    let totalSent = 0;
    
    while (true) {
      const messages = await ContactCampaignMessage.find({
        userId,
        campaignIds: { $in: campaignIds },
        'campaigns.status': 'draft'
      })
      .select('recipientPhoneNumber campaigns')
      .limit(BATCH_SIZE)
      .skip(skip)
      .lean();
      
      if (messages.length === 0) break;
      
      console.log(`[CampaignSender] Processing batch: ${messages.length} messages`);
      
      // Send all to Kafka in parallel (fire-and-forget)
      const kafkaPromises = [];
      const updateOps = []; // Track updates per sub-campaign
      
      for (const contact of messages) {
        const campaignData = contact.campaigns.find(c => 
          campaignIds.some(id => id.toString() === c.campaignId.toString()) && c.status === 'draft'
        );
        
        if (!campaignData) continue;
        
        // Fire-and-forget to Kafka (no await)
        kafkaPromises.push(
          sendMessageToKafka({
            messageId: campaignData.messageId,
            phoneNumber: `+91${contact.recipientPhoneNumber}`,
            userId: userId.toString(),
            campaignId: campaignData.campaignId.toString(),
            templateId: template._id.toString(),
            templateType: template.templateType,
            content: templatePayload,
            variables: {}
          })
        );
        
        updateOps.push({
          campaignId: campaignData.campaignId,
          messageId: campaignData.messageId
        });
      }
      
      // Wait for all Kafka sends (they're already fire-and-forget internally)
      await Promise.all(kafkaPromises);
      
      // Bulk update all statuses - group by campaignId for proper arrayFilters
      const updatesByCampaign = {};
      updateOps.forEach(op => {
        const cid = op.campaignId.toString();
        if (!updatesByCampaign[cid]) updatesByCampaign[cid] = [];
        updatesByCampaign[cid].push(op.messageId);
      });
      
      await Promise.all(
        Object.entries(updatesByCampaign).map(([cid, messageIds]) =>
          ContactCampaignMessage.updateMany(
            {
              userId,
              'campaigns.campaignId': cid,
              'campaigns.messageId': { $in: messageIds },
              'campaigns.status': 'draft'
            },
            {
              $set: {
                'campaigns.$[elem].status': 'queued',
                'campaigns.$[elem].queuedAt': new Date()
              }
            },
            {
              arrayFilters: [
                { 
                  'elem.campaignId': cid,
                  'elem.messageId': { $in: messageIds },
                  'elem.status': 'draft'
                }
              ]
            }
          )
        )
      );
      
      totalSent += updateOps.length;
      console.log(`[CampaignSender] Queued ${totalSent} messages (${Math.round(totalSent / ((Date.now() - startTime) / 1000))}/sec)`);
      
      skip += BATCH_SIZE;
    }
    
    const duration = (Date.now() - startTime) / 1000;
    const rate = Math.round(totalSent / duration);
    console.log(`[CampaignSender] ✅ Queued ${totalSent} messages in ${duration}s (${rate}/sec)`);
    
    return { sent: totalSent, duration, rate };
    
  } catch (error) {
    console.error('[CampaignSender] Error:', error);
    throw error;
  }
}
