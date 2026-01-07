import mongoose from 'mongoose';
import ContactCampaignMessage from '../models/message.model.js';
import MessageLog from '../models/messageLog.model.js';
import Campaign from '../models/campaign.model.js';
import User from '../models/user.model.js';
import statsService from '../services/CampaignStatsService.js';

// Process Jio webhook status updates - LIGHTWEIGHT VERSION
export async function processWebhookData(data, timestamp) {
  console.log('[Webhook] ========== START PROCESSING ==========');
  console.log('[Webhook] Full webhook data:', JSON.stringify(data, null, 2));
  
  try {
    const messageId = data?.entity?.messageId || data?.messageId;
    const eventType = data?.entity?.eventType || data?.webhookData?.eventType || data?.eventType;

    console.log(`[Webhook] Extracted: messageId=${messageId}, eventType=${eventType}`);

    if (!messageId) {
      console.warn('[Webhook] ❌ No messageId found in webhook data');
      console.log('[Webhook] ========== END (NO MESSAGE ID) ==========');
      return;
    }

    // Get campaign and user IDs
    console.log('[Webhook] Querying database for userId and campaignId...');
    const campaignId = await getCampaignIdFromMessage(messageId);
    const userId = await getUserIdFromMessage(messageId);

    console.log(`[Webhook] Query results: userId=${userId}, campaignId=${campaignId}`);

    if (!userId) {
      console.warn(`[Webhook] ❌ No userId found for messageId: ${messageId}`);
      console.warn(`[Webhook] This usually means the message failed to send and was never saved to database`);
      console.warn(`[Webhook] Creating orphan log entry for tracking...`);
      
      // Create log entry WITHOUT userId for tracking failed messages
      try {
        await MessageLog.create({
          messageId,
          campaignId: campaignId || null,
          userId: new mongoose.Types.ObjectId('000000000000000000000000'), // Placeholder
          eventType: 'status_update',
          status: 'success',
          webhookData: {
            eventType,
            phoneNumber: data?.userPhoneNumber || data?.phoneNumber,
            rawPayload: data
          },
          processed: false,
          metadata: {
            source: 'webhook',
            note: 'Orphan webhook - message not found in database'
          }
        });
        console.log(`[Webhook] ✅ Created orphan log for tracking`);
      } catch (orphanError) {
        console.error(`[Webhook] Failed to create orphan log:`, orphanError.message);
      }
      
      console.log('[Webhook] ========== END (NO USER ID) ==========');
      return;
    }

    // Just create log entry - processor will handle the rest
    console.log('[Webhook] Creating MessageLog entry...');
    const logData = {
      messageId,
      campaignId,
      userId,
      eventType,
      phoneNumber: data?.userPhoneNumber || data?.phoneNumber,
      isUserInteraction: false,
      rawPayload: data
    };
    console.log('[Webhook] Log data:', JSON.stringify(logData, null, 2));
    
    try {
      const createdLog = await MessageLog.logWebhookEvent(logData);
      console.log(`[Webhook] ✅ MessageLog created with ID: ${createdLog._id}`);
      
      // Verify it was actually saved
      const verify = await MessageLog.findById(createdLog._id);
      if (verify) {
        console.log(`[Webhook] ✅ Verified in database: ${verify._id}`);
      } else {
        console.error(`[Webhook] ❌ NOT FOUND in database after creation!`);
      }
    } catch (createError) {
      console.error('[Webhook] ❌ Failed to create MessageLog:', createError.message);
      console.error('[Webhook] Error details:', createError);
      throw createError;
    }
    
    console.log(`[Webhook] ✅ Logged ${eventType} for ${messageId}`);
    console.log('[Webhook] ========== END (SUCCESS) ==========');

  } catch (error) {
    console.error('[Webhook] ❌ ERROR:', error);
    console.error('[Webhook] Error stack:', error.stack);
    console.log('[Webhook] ========== END (ERROR) ==========');
    throw error;
  }
}

// Process Jio user interactions - LIGHTWEIGHT VERSION
export async function processUserInteraction(data, timestamp) {
  try {
    const orgMsgId = data?.metaData?.orgMsgId || data?.messageId;

    console.log(`[Webhook] Processing user interaction: messageId=${orgMsgId}`);

    if (!orgMsgId) {
      console.warn('[Webhook] ❌ No orgMsgId found in interaction data');
      return;
    }

    const campaignId = await getCampaignIdFromMessage(orgMsgId);
    const userId = await getUserIdFromMessage(orgMsgId);

    if (!userId) {
      console.warn(`[Webhook] ❌ No userId found for messageId: ${orgMsgId}`);
      return;
    }

    // Just create log entry - processor will handle the rest
    await MessageLog.logWebhookEvent({
      messageId: orgMsgId,
      campaignId,
      userId,
      eventType: 'USER_MESSAGE',
      phoneNumber: data?.userPhoneNumber || data?.phoneNumber,
      isUserInteraction: true,
      suggestionResponse: data?.entity?.suggestionResponse || data?.webhookData?.suggestionResponse,
      rawPayload: data // Store full webhook data
    });

    console.log(`[Webhook] ✅ Logged user interaction for ${orgMsgId}`);

  } catch (error) {
    console.error('[Webhook] ❌ Error logging interaction:', error.message);
    throw error;
  }
}

// Helper functions
async function getCampaignIdFromMessage(messageId) {
  try {
      const message = await ContactCampaignMessage.findOne(
      { 'campaigns.messageId': messageId },
      { 'campaigns.$': 1 }
    ).lean();
    
    const campaignId = message?.campaigns?.[0]?.campaignId;
    console.log(`[Webhook] Found campaignId: ${campaignId} for messageId: ${messageId}`);
    return campaignId;
  } catch (error) {
    console.error(`[Webhook] Error getting campaignId for ${messageId}:`, error.message);
    return null;
  }
}

async function getUserIdFromMessage(messageId) {
  try {
    const message = await ContactCampaignMessage.findOne(
      { 'campaigns.messageId': messageId },
      { userId: 1 }
    ).lean();
    
    const userId = message?.userId;
    console.log(`[Webhook] Found userId: ${userId} for messageId: ${messageId}`);
    return userId;
  } catch (error) {
    console.error(`[Webhook] Error getting userId for ${messageId}:`, error.message);
    return null;
  }
}