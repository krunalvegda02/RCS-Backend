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
    
    const template = campaign.templateId;
    const templatePayload = template.generatePayload();
    
    // Get all draft messages in batches
    const BATCH_SIZE = 5000;
    let skip = 0;
    let totalSent = 0;
    
    while (true) {
      const messages = await ContactCampaignMessage.find({
        userId,
        'campaigns.campaignId': campaignId,
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
      const messageIds = [];
      
      for (const contact of messages) {
        const campaignData = contact.campaigns.find(c => 
          c.campaignId.toString() === campaignId.toString() && c.status === 'draft'
        );
        
        if (!campaignData) continue;
        
        messageIds.push(campaignData.messageId);
        
        // Fire-and-forget to Kafka (no await)
        kafkaPromises.push(
          sendMessageToKafka({
            messageId: campaignData.messageId,
            phoneNumber: `+91${contact.recipientPhoneNumber}`,
            userId: userId.toString(),
            campaignId: campaignId.toString(),
            templateId: template._id.toString(),
            templateType: template.templateType,
            content: templatePayload,
            variables: {}
          })
        );
      }
      
      // Wait for all Kafka sends (they're already fire-and-forget internally)
      await Promise.all(kafkaPromises);
      
      // Bulk update all statuses in ONE query
      await ContactCampaignMessage.updateMany(
        {
          userId,
          'campaigns.campaignId': campaignId,
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
              'elem.campaignId': campaignId,
              'elem.messageId': { $in: messageIds },
              'elem.status': 'draft'
            }
          ]
        }
      );
      
      totalSent += messageIds.length;
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
