import Message from '../models/message.model.js';
import { APIResult } from '../models/APIReport.model.js';
import Campaign from '../models/campaign.model.js';
import redis from 'redis';

const redisClient = redis.createClient({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
});

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