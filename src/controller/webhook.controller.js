import Message from '../models/message.model.js';
import MessageLog from '../models/messageLog.model.js';
import Campaign from '../models/campaign.model.js';
import User from '../models/user.model.js';
import statsService from '../services/CampaignStatsService.js';

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
        // Balance stays blocked until delivered or failed
        break;

      case "MESSAGE_DELIVERED":
        newStatus = 'delivered';
        updateData.deliveredAt = new Date(sendTime || timestamp);
        statType = 'delivered';
        updateData.deviceType = data?.entity?.deviceInfo?.deviceType || null;
        console.log(`[Webhook] 📦 Message DELIVERED: ${messageId}`);
        
        // Only unblock (money already deducted when blocked, now just reduce blocked amount)
        const userId = await getUserIdFromMessage(messageId);
        if (userId) {
          try {
            const user = await User.findById(userId);
            if (user) {
              const beforeBalance = user.wallet.balance;
              const beforeBlocked = user.wallet.blockedBalance;
              
              // Just unblock (balance stays same - user was charged when blocked)
              user.wallet.blockedBalance = Math.max(0, (user.wallet.blockedBalance || 0) - 1);
              user.wallet.lastUpdated = new Date();
              
              // Add transaction record
              user.wallet.transactions.push({
                type: 'debit',
                amount: 1,
                balanceAfter: user.wallet.balance,
                description: `Message delivered - charged: ${messageId}`,
                createdAt: new Date()
              });
              
              await user.save();
              
              console.log(`[Webhook] 💰 Delivered - Balance: ₹${beforeBalance} (charged), Blocked: ₹${beforeBlocked} → ₹${user.wallet.blockedBalance}`);
              
              const campaignIdForCost = await getCampaignIdFromMessage(messageId);
              if (campaignIdForCost) {
                await Campaign.updateOne({ _id: campaignIdForCost }, { $inc: { actualCost: 1 } });
              }
            }
          } catch (walletError) {
            console.error(`[Webhook] Wallet error:`, walletError);
          }
        }
        break;

      case "MESSAGE_READ":
        newStatus = 'read';
        updateData.readAt = new Date(sendTime || timestamp);
        statType = 'read';
        console.log(`[Webhook] 👁 Message READ: ${messageId}`);
        break;

      case "SEND_MESSAGE_FAILURE":
        const errorCode = data?.entity?.error?.code;
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
        
        // Unblock and refund (move from blocked back to wallet)
        const failedUserId = await getUserIdFromMessage(messageId);
        if (failedUserId) {
          try {
            const failedUser = await User.findById(failedUserId);
            if (failedUser) {
              const beforeBalance = failedUser.wallet.balance;
              const beforeBlocked = failedUser.wallet.blockedBalance;
              
              // Unblock and add back to wallet (refund)
              failedUser.wallet.blockedBalance = Math.max(0, (failedUser.wallet.blockedBalance || 0) - 1);
              failedUser.wallet.balance += 1;
              failedUser.wallet.lastUpdated = new Date();
              
              await failedUser.save();
              
              console.log(`[Webhook] 🔄 Failed - Balance: ₹${beforeBalance} → ₹${failedUser.wallet.balance}, Blocked: ₹${beforeBlocked} → ₹${failedUser.wallet.blockedBalance}`);
            }
          } catch (error) {
            console.error(`[Webhook] Refund error:`, error);
          }
        }
        break;

      case "MESSAGE_EXPIRED":
        newStatus = 'failed';
        statType = 'failed';
        updateData.failedAt = new Date(sendTime || timestamp);
        updateData.errorCode = 'MESSAGE_EXPIRED';
        updateData.errorMessage = 'Message expired before delivery';
        console.log(`[Webhook] ⏰ Message EXPIRED: ${messageId}`);
        
        // Unblock and refund (move from blocked back to wallet)
        const expiredUserId = await getUserIdFromMessage(messageId);
        if (expiredUserId) {
          try {
            const expiredUser = await User.findById(expiredUserId);
            if (expiredUser) {
              const beforeBalance = expiredUser.wallet.balance;
              const beforeBlocked = expiredUser.wallet.blockedBalance;
              
              // Unblock and add back to wallet (refund)
              expiredUser.wallet.blockedBalance = Math.max(0, (expiredUser.wallet.blockedBalance || 0) - 1);
              expiredUser.wallet.balance += 1;
              expiredUser.wallet.lastUpdated = new Date();
              
              await expiredUser.save();
              
              console.log(`[Webhook] 🔄 Expired - Balance: ₹${beforeBalance} → ₹${expiredUser.wallet.balance}, Blocked: ₹${beforeBlocked} → ₹${expiredUser.wallet.blockedBalance}`);
            }
          } catch (error) {
            console.error(`[Webhook] Refund error:`, error);
          }
        }
        break;

      case "MESSAGE_REVOKED":
        newStatus = 'failed';
        statType = 'failed';
        updateData.failedAt = new Date(sendTime || timestamp);
        updateData.errorCode = 'MESSAGE_REVOKED';
        updateData.errorMessage = 'Message was revoked';
        console.log(`[Webhook] 🚫 Message REVOKED: ${messageId}`);
        
        // Unblock and refund (move from blocked back to wallet)
        const revokedUserId = await getUserIdFromMessage(messageId);
        if (revokedUserId) {
          try {
            const revokedUser = await User.findById(revokedUserId);
            if (revokedUser) {
              const beforeBalance = revokedUser.wallet.balance;
              const beforeBlocked = revokedUser.wallet.blockedBalance;
              
              // Unblock and add back to wallet (refund)
              revokedUser.wallet.blockedBalance = Math.max(0, (revokedUser.wallet.blockedBalance || 0) - 1);
              revokedUser.wallet.balance += 1;
              revokedUser.wallet.lastUpdated = new Date();
              
              await revokedUser.save();
              
              console.log(`[Webhook] 🔄 Revoked - Balance: ₹${beforeBalance} → ₹${revokedUser.wallet.balance}, Blocked: ₹${beforeBlocked} → ₹${revokedUser.wallet.blockedBalance}`);
            }
          } catch (error) {
            console.error(`[Webhook] Refund error:`, error);
          }
        }
        break;

      default:
        console.warn(`[Webhook] Unknown event type: ${eventType}`);
        return;
    }

    updateData.status = newStatus;

    // Define valid status progressions
    const statusHierarchy = {
      'pending': 0,
      'queued': 1,
      'processing': 2,
      'sent': 3,
      'delivered': 4,
      'read': 5,
      'replied': 6,
      'failed': 7,
      'bounced': 7
    };

    let currentMessage = await Message.findOne({
      messageId: messageId
    }, 'status messageId').lean();
    
    if (!currentMessage) {
      console.warn(`[Webhook] Message not found: ${messageId}`);
      return;
    }

    const currentStatusLevel = statusHierarchy[currentMessage.status] || 0;
    const newStatusLevel = statusHierarchy[newStatus] || 0;

    if (newStatusLevel < currentStatusLevel) {
      console.log(`[Webhook] Skipping status downgrade: ${currentMessage.status} → ${newStatus} for ${messageId}`);
      return;
    }

    const [message, campaignId] = await Promise.all([
      Message.findOneAndUpdate(
        { messageId: messageId },
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

    await Promise.all([
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
      MessageLog.logWebhookEvent({
        messageId,
        campaignId,
        userId: await getUserIdFromMessage(messageId),
        eventType,
        phoneNumber: userPhoneNumber,
        isUserInteraction: false,
      }),
      statType && campaignId ? statsService.incrementStat(campaignId, statType) : Promise.resolve()
    ]);

    // console.log(`[RCS] 📊 Campaign recipient status updated to '${newStatus}'`);
    // console.log(`[RCS] 💾 Message status updated to '${newStatus}' in database`);

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

    console.log(`[RCS] ✅ ${eventType} processed for ${messageId} → ${newStatus}`);

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

    if (suggestionResponse) {
      updateFields.suggestionResponse = suggestionResponse;
      updateFields.clickedAt = new Date(userMessage?.sendTime || timestamp);
      updateFields.clickedAction = suggestionResponse.plainText;
      interactionType = suggestionResponse.type === 'ACTION' ? 'action_click' : 'reply_click';
      incFields.userClickCount = 1;

      console.log(`[Webhook] 🔘 Button clicked: ${suggestionResponse.plainText}`);
    }

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
      statsService.incrementStat(campaignId, 'replied')
    ]);

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
      messageId: messageId
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
      messageId: messageId
    }, 'userId').lean();
    return message?.userId;
  } catch (error) {
    console.error('Error getting user ID:', error);
    return null;
  }
}