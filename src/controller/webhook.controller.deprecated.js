// ⚠️ DEPRECATED - DO NOT USE IN PRODUCTION
// These functions perform individual DB writes and are NOT scalable
// Use kafkaConsumer.js with bulk insertMany() instead

import mongoose from 'mongoose';
import ContactCampaignMessage from '../models/contact_campaign_message.model.js';
import MessageLog from '../models/messageLog.model.js';

// ❌ DEPRECATED: Individual DB writes, not scalable
export async function processWebhookData(data, timestamp) {
  throw new Error('DEPRECATED: Use kafkaConsumer.js bulk processing instead');
}

// ❌ DEPRECATED: Individual DB writes, not scalable
export async function processUserInteraction(data, timestamp) {
  throw new Error('DEPRECATED: Use kafkaConsumer.js bulk processing instead');
}

// Helper function - kept for reference only
async function getCampaignAndUserIds(messageId) {
  try {
    const message = await ContactCampaignMessage.findOne(
      { 'campaigns.messageId': messageId },
      { userId: 1, 'campaigns.$': 1 }
    ).lean();
    
    return {
      userId: message?.userId || null,
      campaignId: message?.campaigns?.[0]?.campaignId || null
    };
  } catch (error) {
    console.error(`[Webhook] Error getting IDs for ${messageId}:`, error.message);
    return { userId: null, campaignId: null };
  }
}
