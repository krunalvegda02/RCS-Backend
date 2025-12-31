import Message from '../models/message.model.js';
import MessageLog from '../models/messageLog.model.js';
import Campaign from '../models/campaign.model.js';
import statsService from '../services/CampaignStatsService.js';

// NO Redis client here - Bull handles Redis internally
// NO queue processing here - only in worker.js

// Ultra-lightweight webhook receiver - only queues, no processing
export const webhookReceiver = async (req, res) => {
  // This function is now deprecated - use direct queue in app.js
  console.warn('[Webhook] webhookReceiver is deprecated - use direct queue');
  res.status(200).json({ success: true });
};

// Process Jio webhook status updates
export async function processWebhookData(data, timestamp) {
  try {
    const entityType = data?.entityType;
    const eventType = data?.entity?.eventType || data?.webhookData?.eventType || data?.eventType;
    const messageId = data?.entity?.messageId || data?.messageId;
    const userPhoneNumber = data?.userPhoneNumber || data?.webhookData?.phoneNumber || data?.phoneNumber;
    const sendTime = data?.entity?.sendTime || timestamp;

    if (!messageId) {
      console.warn('[Webhook] No messageId found in status update');
      return;
    }

    console.log(`[Webhook] Processing ${entityType || 'STATUS'}:${eventType} for ${messageId}`);

    const updateData = {
      lastWebhookAt: new Date(sendTime || timestamp),
      error: !!data?.entity?.error,
      errorMessage: data?.entity?.error?.message || null,
      errorCode: data?.entity?.error?.code || null
    };

    let statType = null;
    let newStatus = null;

    // Enhanced Jio webhook event mapping with detailed error handling
    switch (eventType) {
      case "SEND_MESSAGE_SUCCESS":
      case "MESSAGE_SENT":
        newStatus = 'sent';
        updateData.sentAt = new Date(sendTime || timestamp);
        statType = 'sent';
        updateData.deliveryLatency = data?.entity?.deliveryInfo?.latencyMs || null;
        console.log(`[Webhook] ✅ Message SENT: ${messageId}`);
        break;

      case "MESSAGE_DELIVERED":
        newStatus = 'delivered';
        updateData.deliveredAt = new Date(sendTime || timestamp);
        statType = 'delivered';
        updateData.deviceType = data?.entity?.deviceInfo?.deviceType || null;
        console.log(`[Webhook] 📦 Message DELIVERED: ${messageId}`);
        break;

      case "MESSAGE_READ":
        newStatus = 'read';
        updateData.readAt = new Date(sendTime || timestamp);
        statType = 'read';
        console.log(`[Webhook] 👁 Message READ: ${messageId}`);
        break;

      case "SEND_MESSAGE_FAILURE":
        // Enhanced error classification based on Jio error codes
        const errorCode = data?.entity?.error?.code;
        const errorCategory = data?.entity?.error?.category;

        // Comprehensive bounce detection
        const bounceErrorCodes = [
          'INVALID_PHONE', 'PHONE_NOT_REACHABLE', 'BLOCKED_NUMBER',
          'SUBSCRIBER_NOT_FOUND', 'NUMBER_PORTED', 'DEVICE_OFFLINE',
          'RCS_NOT_SUPPORTED', 'CAPABILITY_EXPIRED'
        ];

        if (errorCode && bounceErrorCodes.includes(errorCode)) {
          newStatus = 'bounced';
          statType = 'bounced';
          console.log(`[Webhook] ⚠️ Message BOUNCED: ${messageId} - ${errorCode}`);
        } else {
          newStatus = 'failed';
          statType = 'failed';
          console.log(`[Webhook] ❌ Message FAILED: ${messageId} - ${errorCode}`);
        }

        updateData.failedAt = new Date(sendTime || timestamp);
        updateData.errorCode = errorCode || 'UNKNOWN';
        updateData.errorMessage = data?.entity?.error?.message || 'Unknown error';
        break;

      case "MESSAGE_EXPIRED":
        newStatus = 'failed';
        statType = 'failed';
        updateData.failedAt = new Date(sendTime || timestamp);
        updateData.errorCode = 'MESSAGE_EXPIRED';
        updateData.errorMessage = 'Message expired before delivery';
        console.log(`[Webhook] ⏰ Message EXPIRED: ${messageId}`);
        break;

      case "MESSAGE_REVOKED":
        newStatus = 'failed';
        statType = 'failed';
        updateData.failedAt = new Date(sendTime || timestamp);
        updateData.errorCode = 'MESSAGE_REVOKED';
        updateData.errorMessage = 'Message was revoked';
        console.log(`[Webhook] 🚫 Message REVOKED: ${messageId}`);
        break;

      default:
        console.warn(`[Webhook] Unknown event type: ${eventType}`);
        return;
    }

    updateData.status = newStatus;

    // Define valid status progressions
    const statusHierarchy = {
      'pending': 0,
      'sent': 1,
      'delivered': 2,
      'read': 3,
      'failed': 4,
      'bounced': 4,
      'replied': 5
    };

    // Simple message lookup - webhook messageId matches rcsMessageId in database
    let currentMessage = await Message.findOne({
      rcsMessageId: messageId
    }, 'status messageId').lean();
    
    if (!currentMessage) {
      console.log(`[Webhook] Message not found with rcsMessageId: ${messageId}`);
      return;
    }
    
    console.log(`[Webhook] Found message: ${currentMessage.messageId}`);


    const currentStatusLevel = statusHierarchy[currentMessage.status] || 0;
    const newStatusLevel = statusHierarchy[newStatus] || 0;

    // Only update if new status is higher in hierarchy or same level (for retries)
    if (newStatusLevel < currentStatusLevel) {
      console.log(`[Webhook] Skipping status downgrade: ${currentMessage.status} → ${newStatus} for ${messageId}`);
      return;
    }

    // Update message using rcsMessageId
    const [message, campaignId] = await Promise.all([
      Message.findOneAndUpdate(
        { rcsMessageId: messageId },
        {
          status: newStatus,
          lastWebhookAt: new Date(sendTime || timestamp),
          sentAt: newStatus === 'sent' ? new Date(sendTime || timestamp) : undefined,
          deliveredAt: newStatus === 'delivered' ? new Date(sendTime || timestamp) : undefined,
          readAt: newStatus === 'read' ? new Date(sendTime || timestamp) : undefined,
          failedAt: ['failed', 'bounced'].includes(newStatus) ? new Date(sendTime || timestamp) : undefined,
          errorCode: ['failed', 'bounced'].includes(newStatus) ? updateData.errorCode : undefined,
          errorMessage: ['failed', 'bounced'].includes(newStatus) ? updateData.errorMessage : undefined,
          deviceType: updateData.deviceType || undefined,
          deliveryLatency: updateData.deliveryLatency || undefined
        },
        { new: true, lean: true }
      ),
      getCampaignIdFromMessage(currentMessage.messageId)
    ]);

    if (!message || !campaignId) {
      console.warn(`[Webhook] Message or campaign not found, or status unchanged: ${messageId}`);
      return;
    }

    // Update campaign recipient status and increment Redis stats (only if message was updated)
    await Promise.all([
      // Update recipient status in campaign (allow status progression)
      Campaign.updateOne(
        {
          _id: campaignId,
          'recipients.phoneNumber': userPhoneNumber
        },
        {
          $set: {
            'recipients.$.status': newStatus,
            'recipients.$.sentAt': newStatus === 'sent' ? new Date(sendTime || timestamp) : undefined,
            'recipients.$.deliveredAt': newStatus === 'delivered' ? new Date(sendTime || timestamp) : undefined,
            'recipients.$.readAt': newStatus === 'read' ? new Date(sendTime || timestamp) : undefined,
            'recipients.$.failedAt': ['failed', 'bounced'].includes(newStatus) ? new Date(sendTime || timestamp) : undefined,
            'recipients.$.errorMessage': ['failed', 'bounced'].includes(newStatus) ? updateData.errorMessage : undefined
          }
        }
      ),
      // Log webhook event
      MessageLog.logWebhookEvent({
        messageId,
        campaignId,
        userId: await getUserIdFromMessage(messageId),
        eventType,
        phoneNumber: userPhoneNumber,
        isUserInteraction: false,
      }),
      // Increment Redis stats for real-time performance (only if statType is valid)
      statType && campaignId ? statsService.incrementStat(campaignId, statType) : Promise.resolve()
    ]);

    // Emit real-time update via Socket.IO (if available)
    if (global.io && campaignId) {
      global.io.to(`campaign_${campaignId}`).emit('message_status_update', {
        messageId,
        campaignId,
        status: newStatus,
        phoneNumber: userPhoneNumber,
        timestamp: sendTime || timestamp,
        eventType
      });
    }

    console.log(`[Webhook] ✅ ${eventType} processed for ${messageId} → ${newStatus}`);

  } catch (error) {
    console.error('[Webhook] Error processing status update:', error);
    throw error;
  }
}

// Process Jio user interactions
export async function processUserInteraction(data, timestamp) {
  try {
    const orgMsgId = data?.metaData?.orgMsgId || data?.messageId;
    const userMessage = data?.entity || data?.webhookData;
    const suggestionResponse = userMessage?.suggestionResponse;
    const userText = userMessage?.text;
    const userPhoneNumber = data?.userPhoneNumber || data?.webhookData?.phoneNumber;

    if (!orgMsgId) {
      console.warn('[Webhook] No orgMsgId found in user interaction');
      return;
    }

    console.log(`[Webhook] Processing user interaction for ${orgMsgId}`);

    // Get campaignId once before Promise.all
    const campaignId = await getCampaignIdFromMessage(orgMsgId);
    if (!campaignId) {
      console.warn(`[Webhook] Campaign not found for message: ${orgMsgId}`);
      return;
    }

    let interactionType = 'text';
    const updateFields = {
      status: 'replied',
      lastInteractionAt: new Date(userMessage?.sendTime || timestamp)
    };
    const incFields = {};

    // Handle suggestion responses (button clicks)
    if (suggestionResponse) {
      updateFields.suggestionResponse = suggestionResponse;
      updateFields.clickedAt = new Date(userMessage?.sendTime || timestamp);
      updateFields.clickedAction = suggestionResponse.plainText;
      interactionType = suggestionResponse.type === 'ACTION' ? 'action_click' : 'reply_click';
      incFields.userClickCount = 1;

      console.log(`[Webhook] 🔘 Button clicked: ${suggestionResponse.plainText}`);
    }

    // Handle text messages
    if (userText && userText.trim()) {
      updateFields.userText = userText;
      interactionType = 'text_reply';
      incFields.userReplyCount = 1;

      console.log(`[Webhook] 💬 Text reply: ${userText}`);
    }

    await Promise.all([
      Message.updateOne(
        { messageId: orgMsgId },
        {
          $set: updateFields,
          $inc: incFields
        }
      ),
      Campaign.updateOne(
        {
          _id: campaignId,
          'recipients.phoneNumber': userPhoneNumber
        },
        {
          $set: {
            'recipients.$.status': 'replied',
            'recipients.$.lastInteractionAt': new Date(userMessage?.sendTime || timestamp)
          }
        }
      ),
      // Log user interaction
      MessageLog.logWebhookEvent({
        messageId: orgMsgId,
        campaignId,
        userId: await getUserIdFromMessage(orgMsgId),
        eventType: 'USER_MESSAGE',
        phoneNumber: userPhoneNumber,
        isUserInteraction: true,
        interactionType,
        suggestionResponse: suggestionResponse || { text: userText },
      }),
      // Increment replied stat in Redis
      statsService.incrementStat(campaignId, 'replied')
    ]);

    // Emit real-time update
    if (global.io && campaignId) {
      global.io.to(`campaign_${campaignId}`).emit('user_interaction', {
        messageId: orgMsgId,
        campaignId,
        phoneNumber: userPhoneNumber,
        interactionType,
        text: userText,
        suggestionResponse,
        timestamp: userMessage?.sendTime || timestamp
      });
    }

    console.log(`[Webhook] ✅ User interaction processed for ${orgMsgId} - ${interactionType}`);

  } catch (error) {
    console.error('[Webhook] Error processing user interaction:', error);
    throw error;
  }
}

// Helper functions
async function getCampaignIdFromMessage(messageId) {
  try {
    const message = await Message.findOne({
      $or: [
        { messageId },
        { jioMessageId: messageId },
        { externalMessageId: messageId },
        { rcsMessageId: messageId }
      ]
    }, 'campaignId').lean();
    return message?.campaignId;
  } catch (error) {
    console.error('Error getting campaign ID:', error);
    return null;
  }
}

async function getUserIdFromMessage(messageId) {
  try {
    const message = await Message.findOne({
      $or: [
        { messageId },
        { jioMessageId: messageId },
        { externalMessageId: messageId },
        { rcsMessageId: messageId }
      ]
    }, 'userId').lean();
    return message?.userId;
  } catch (error) {
    console.error('Error getting user ID:', error);
    return null;
  }
}









// High-performance status update handler
export const handleStatusUpdate = async (req, res) => {
  try {
    // Immediate response
    res.json({ success: true });

    const { messageId, status, timestamp, errorCode, errorMessage } = req.body;

    if (!messageId || !status) {
      console.warn('[Webhook] Invalid status update data');
      return;
    }

    // Queue for background processing
    await webhookQueue.add('status-update', {
      data: {
        entity: {
          messageId,
          eventType: status,
          error: errorCode ? { code: errorCode, message: errorMessage } : null
        }
      },
      timestamp: timestamp || new Date().toISOString()
    });

  } catch (error) {
    console.error('Status update error:', error);
    if (!res.headersSent) {
      res.status(200).json({ success: true }); // Don't fail webhooks
    }
  }
};














// Handle delivery webhook
export const handleDelivery = async (req, res) => {
  try {
    const { messageId, deliveredAt } = req.body;

    const message = await Message.findOne({ messageId });
    if (!message) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }

    await message.markAsDelivered();

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


// Handle read webhook
export const handleRead = async (req, res) => {
  try {
    const { messageId, readAt } = req.body;

    await Message.updateOne(
      { messageId },
      { status: 'read', clickedAt: new Date(readAt) }
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Handle reply webhook
export const handleReply = async (req, res) => {
  try {
    const { messageId, reply, repliedAt, action, uri } = req.body;

    const message = await Message.findOne({ messageId });
    if (!message) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }

    await message.recordClick(action, uri);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};