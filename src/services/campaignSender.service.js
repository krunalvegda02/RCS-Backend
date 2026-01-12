import ContactCampaignMessage from '../models/contact_campaign_message.model.js';
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
    const userIdStr = userId.toString();
    const templateIdStr = template._id.toString();
    
    // OPTIMIZATION 1: Use cursor instead of skip (10x faster for large datasets)
    const cursor = ContactCampaignMessage.find({
      userId,
      campaignIds: { $in: campaignIds },
      'campaigns.status': 'draft'
    })
    .select('recipientPhoneNumber campaigns')
    .lean()
    .cursor();
    
    let totalSent = 0;
    let batch = [];
    const BATCH_SIZE = 10000; // Increased batch size
    
    // OPTIMIZATION 2: Process in batches without waiting for updates
    for await (const contact of cursor) {
      const campaignData = contact.campaigns.find(c => 
        campaignIds.some(id => id.toString() === c.campaignId.toString()) && c.status === 'draft'
      );
      
      if (!campaignData) continue;
      
      batch.push({
        contact,
        campaignData,
        campaignIdStr: campaignData.campaignId.toString()
      });
      
      // Process batch when full
      if (batch.length >= BATCH_SIZE) {
        await processBatch(batch, templatePayload, userIdStr, templateIdStr, template.templateType, userId);
        totalSent += batch.length;
        console.log(`[CampaignSender] Queued ${totalSent} messages (${Math.round(totalSent / ((Date.now() - startTime) / 1000))}/sec)`);
        batch = [];
      }
    }
    
    // Process remaining messages
    if (batch.length > 0) {
      await processBatch(batch, templatePayload, userIdStr, templateIdStr, template.templateType, userId);
      totalSent += batch.length;
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

// OPTIMIZATION 3: Separate function for batch processing
async function processBatch(batch, templatePayload, userIdStr, templateIdStr, templateType, userId) {
  // OPTIMIZATION 4: Send to Kafka without waiting (true fire-and-forget)
  const kafkaPromises = batch.map(item => 
    sendMessageToKafka({
      messageId: item.campaignData.messageId,
      phoneNumber: `+91${item.contact.recipientPhoneNumber}`,
      userId: userIdStr,
      campaignId: item.campaignIdStr,
      templateId: templateIdStr,
      templateType,
      content: templatePayload,
      variables: {}
    }).catch(err => console.error('[Kafka] Send error:', err.message))
  );
  
  // OPTIMIZATION 5: Group updates by campaign for parallel execution
  const updatesByCampaign = {};
  batch.forEach(item => {
    if (!updatesByCampaign[item.campaignIdStr]) updatesByCampaign[item.campaignIdStr] = [];
    updatesByCampaign[item.campaignIdStr].push(item.campaignData.messageId);
  });
  
  // OPTIMIZATION 6: Fire Kafka sends and DB updates in parallel (don't wait for Kafka)
  const updatePromises = Object.entries(updatesByCampaign).map(([cid, messageIds]) =>
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
    ).catch(err => console.error('[DB] Update error:', err.message))
  );
  
  // Wait only for DB updates (Kafka is fire-and-forget)
  await Promise.all(updatePromises);
}
