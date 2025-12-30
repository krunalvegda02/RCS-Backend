import Message from '../models/message.model.js';
import { APIResult } from '../models/APIReport.model.js';
import Campaign from '../models/campaign.model.js';
import redis from 'redis';

const redisClient = redis.createClient({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
});








// Handle Jio RCS webhook responses
export const webhookReceiver = async (req, res) => {
  try {
    const data = req.body;
    const timestamp = new Date().toISOString();
    
    console.log('\n📥 JIO RCS WEBHOOK RECEIVED');
    console.log(`⏰ Timestamp: ${timestamp}`);
    console.log('🔗 Method:', req.method);
    console.log('🌐 URL:', req.url);
    console.log('🌍 Real webhook URL: https://heartiest-carmon-undatable.ngrok-free.dev/api/v1/webhooks/jio/rcs/webhook');
    console.log('⚙️  Configure this URL in Jio RCS Dashboard → Settings → Webhooks');
    console.log('\n--- 📋 HEADERS ---');
    Object.entries(req.headers).forEach(([key, value]) => {
      console.log(`${key}: ${value}`);
    });
    console.log('\n--- 📦 WEBHOOK DATA ---');
    console.log(JSON.stringify(data, null, 2));
    
    // Extract common fields
    const eventType = data?.entity?.eventType || data?.entityType;
    const orgMsgId = data?.metaData?.orgMsgId; // USER_MESSAGE
    const messageId = data?.entity?.messageId; // STATUS EVENTS
    const userPhoneNumber = data?.userPhoneNumber;
    
    console.log(`\n🔍 Parsed Fields:`);
    console.log(`   EventType: ${eventType}`);
    console.log(`   OrgMsgId: ${orgMsgId}`);
    console.log(`   MessageId: ${messageId}`);
    console.log(`   UserPhone: ${userPhoneNumber}`);
    
    /* =====================================================
       🔵 CASE 1: USER_MESSAGE (User clicked/replied)
    ====================================================== */
    if (eventType === "USER_MESSAGE" && orgMsgId) {
      console.log('\n🎯 Processing USER_MESSAGE event');
      
      const message = await Message.findOne({ messageId: orgMsgId });
      
      if (!message) {
        console.log(`❌ Message not found for orgMsgId: ${orgMsgId}`);
        return res.status(200).json({ success: true });
      }
      
      console.log(`✅ Found message: ${message._id}`);
      
      // Check if this is first click or reply
      const suggestionResponse = data?.entity?.suggestionResponse || [];
      const isFirstClick = !message.userClickCount || message.userClickCount === 0;
      
      if (isFirstClick && suggestionResponse.length > 0) {
        message.userClickCount = (message.userClickCount || 0) + 1;
        console.log(`🟢 FIRST TIME CLICK - Count: ${message.userClickCount}`);
      } else if (suggestionResponse.length > 0) {
        message.userReplyCount = (message.userReplyCount || 0) + 1;
        console.log(`🔵 USER REPLY - Count: ${message.userReplyCount}`);
      }
      
      // Save suggestion response
      message.suggestionResponse = suggestionResponse;
      message.lastInteractionAt = new Date();
      
      await message.save();
      
      console.log(`✅ USER_MESSAGE processed | Clicks: ${message.userClickCount} | Replies: ${message.userReplyCount}`);
      return res.status(200).json({ success: true });
    }
    
    /* =====================================================
       🔵 CASE 2: STATUS EVENTS (DELIVERED/READ/FAILED)
    ====================================================== */
    if (messageId) {
      console.log(`\n📊 Processing STATUS event: ${eventType}`);
      
      const message = await Message.findOne({ messageId });
      
      if (!message) {
        console.log(`❌ Message not found for messageId: ${messageId}`);
        return res.status(200).json({ success: true });
      }
      
      console.log(`✅ Found message: ${message._id}`);
      const oldStatus = message.status;
      
      let updateData = {
        status: eventType,
        lastWebhookAt: new Date(),
        error: !!data?.entity?.error,
        errorMessage: data?.entity?.error?.message || null
      };
      
      /* ---------- 📦 DELIVERED ---------- */
      if (eventType === "MESSAGE_DELIVERED") {
        updateData.status = 'delivered';
        updateData.deliveredAt = new Date();
        message.totalDelivered = (message.totalDelivered || 0) + 1;
        console.log(`📦 MESSAGE DELIVERED - Total: ${message.totalDelivered}`);
      }
      
      /* ---------- 👁 READ ---------- */
      if (eventType === "MESSAGE_READ") {
        updateData.status = 'read';
        updateData.readAt = new Date();
        message.totalRead = (message.totalRead || 0) + 1;
        console.log(`👁 MESSAGE READ - Total: ${message.totalRead}`);
      }
      
      /* ---------- ❌ FAILED ---------- */
      if (eventType === "SEND_MESSAGE_FAILURE") {
        updateData.status = 'failed';
        updateData.failedAt = new Date();
        message.failedCount = (message.failedCount || 0) + 1;
        
        // TODO: Implement wallet refund logic
        console.log(`❌ MESSAGE FAILED - Total: ${message.failedCount}`);
        console.log(`💰 Wallet refund needed for messageId: ${messageId}`);
      }
      
      /* ---------- ✅ SUCCESS ---------- */
      if (eventType === "SEND_MESSAGE_SUCCESS") {
        updateData.status = 'sent';
        updateData.sentAt = new Date();
        message.successCount = (message.successCount || 0) + 1;
        console.log(`✅ MESSAGE SENT SUCCESS - Total: ${message.successCount}`);
      }
      
      // Update message
      Object.assign(message, updateData);
      await message.save();
      
      console.log(`✅ STATUS UPDATED | ${messageId} → ${oldStatus} → ${updateData.status}`);
    }
    
    console.log('\n🎉 WEBHOOK PROCESSING COMPLETE\n');
    
    return res.status(200).json({
      success: true,
      message: "Webhook processed successfully",
      timestamp: timestamp,
      eventType: eventType,
      processed: true
    });
    
  } catch (error) {
    console.error('\n❌ WEBHOOK ERROR:', error);
    console.error('📍 Error stack:', error.stack);
    return res.status(500).json({
      success: false,
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
};









// Optimized webhook for high-volume campaigns
export const handleStatusUpdate = async (req, res) => {
  try {
    const { messageId, status, timestamp, errorCode, errorMessage } = req.body;

    // Use bulk operations for better performance
    const updatePromises = [];
    
    // Update message status
    updatePromises.push(
      Message.updateOne(
        { messageId },
        {
          status: status === 'delivered' ? 'delivered' : status === 'failed' ? 'failed' : status,
          deliveredAt: status === 'delivered' ? new Date(timestamp) : undefined,
          failedAt: status === 'failed' ? new Date(timestamp) : undefined,
          errorCode: status === 'failed' ? errorCode : undefined,
          errorMessage: status === 'failed' ? errorMessage : undefined,
        }
      )
    );

    // Batch update campaign stats (every 100 messages)
    const message = await Message.findOne({ messageId }, 'campaignId');
    if (message?.campaignId) {
      // Use Redis counter for real-time stats, sync to DB periodically
      const redisKey = `campaign_stats:${message.campaignId}`;
      await redisClient.hincrby(redisKey, status, 1);
      await redisClient.expire(redisKey, 3600); // 1 hour TTL
    }

    await Promise.all(updatePromises);

    res.json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ success: false, message: error.message });
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