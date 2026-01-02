import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import Campaign from '../models/campaign.model.js';
import Message from '../models/message.model.js';

export const setupSocketIO = (server) => {
  const io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || process.env.CORS_ORIGIN,
      methods: ["GET", "POST"],
      credentials: true
    }
  });

  // Authentication middleware
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication error'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded._id || decoded.userId;
      socket.join(`user_${socket.userId}`);
      
      next();
    } catch (error) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`User ${socket.userId} connected`);

    // Join campaign room for live updates
    socket.on('join_campaign', (campaignId) => {
      socket.join(`campaign_${campaignId}`);
      console.log(`User ${socket.userId} joined campaign ${campaignId}`);
      
      // Immediately send current stats when joining
      broadcastStatsUpdate(campaignId);
    });

    socket.on('leave_campaign', (campaignId) => {
      socket.leave(`campaign_${campaignId}`);
      console.log(`User ${socket.userId} left campaign ${campaignId}`);
    });

    // Handle real-time stats requests
    socket.on('request_stats', async (campaignId) => {
      try {
        const campaign = await Campaign.findById(campaignId);
        if (campaign && campaign.userId.toString() === socket.userId) {
          // Get comprehensive real-time message counts
          const messageStats = await Message.aggregate([
            { $match: { campaignId: campaignId } },
            {
              $group: {
                _id: '$status',
                count: { $sum: 1 },
                interactions: { $sum: '$userClickCount' },
                replies: { $sum: '$userReplyCount' }
              }
            }
          ]);

          const stats = {
            total: campaign.stats?.total || 0,
            pending: 0,
            processing: 0,
            sent: 0,
            delivered: 0,
            failed: 0,
            bounced: 0,
            read: 0,
            replied: 0,
            interactions: 0,
            totalReplies: 0
          };

          messageStats.forEach(stat => {
            stats[stat._id] = stat.count;
            stats.interactions += stat.interactions || 0;
            stats.totalReplies += stat.replies || 0;
          });

          socket.emit('stats_update', {
            campaignId,
            stats,
            timestamp: new Date().toISOString()
          });
        }
      } catch (error) {
        console.error('Error fetching campaign stats:', error);
      }
    });

    // Handle message refresh requests
    socket.on('refresh_messages', async (campaignId, page = 1, limit = 20) => {
      try {
        const campaign = await Campaign.findById(campaignId);
        if (campaign && campaign.userId.toString() === socket.userId) {
          const messages = await Message.find({ campaignId })
            .select('recipientPhoneNumber status templateType sentAt deliveredAt readAt clickedAt clickedAction userText suggestionResponse userClickCount userReplyCount errorMessage createdAt')
            .sort({ createdAt: -1 })
            .limit(limit)
            .skip((page - 1) * limit)
            .lean();
          
          const total = await Message.countDocuments({ campaignId });
          
          socket.emit('messages_updated', {
            campaignId,
            messages,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) }
          });
        }
      } catch (error) {
        console.error('Error refreshing messages:', error);
      }
    });

    socket.on('disconnect', () => {
      console.log(`User ${socket.userId} disconnected`);
    });
  });

  // Enhanced helper functions for webhook updates
  io.emitCampaignUpdate = (campaignId, updateData) => {
    io.to(`campaign_${campaignId}`).emit('campaign_update', {
      campaignId,
      ...updateData,
      timestamp: new Date().toISOString()
    });
    
    // Also broadcast updated stats
    setTimeout(() => broadcastStatsUpdate(campaignId), 500);
  };

  io.emitMessageStatusUpdate = (campaignId, messageData) => {
    io.to(`campaign_${campaignId}`).emit('message_status_update', {
      campaignId,
      ...messageData,
      timestamp: new Date().toISOString()
    });
    
    // Broadcast updated stats after status change
    setTimeout(() => broadcastStatsUpdate(campaignId), 100);
  };

  io.emitUserInteraction = (campaignId, interactionData) => {
    io.to(`campaign_${campaignId}`).emit('user_interaction', {
      campaignId,
      ...interactionData,
      timestamp: new Date().toISOString()
    });
    
    // Update stats after interaction
    setTimeout(() => broadcastStatsUpdate(campaignId), 100);
  };

  // Broadcast stats updates to all campaign subscribers
  const broadcastStatsUpdate = async (campaignId) => {
    try {
      const campaign = await Campaign.findById(campaignId);
      if (!campaign) return;

      const messageStats = await Message.aggregate([
        { $match: { campaignId: campaignId } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            interactions: { $sum: '$userClickCount' },
            replies: { $sum: '$userReplyCount' }
          }
        }
      ]);

      const stats = {
        total: campaign.stats?.total || 0,
        pending: 0,
        processing: 0,
        sent: 0,
        delivered: 0,
        failed: 0,
        bounced: 0,
        read: 0,
        replied: 0,
        interactions: 0,
        totalReplies: 0
      };

      messageStats.forEach(stat => {
        stats[stat._id] = stat.count;
        stats.interactions += stat.interactions || 0;
        stats.totalReplies += stat.replies || 0;
      });

      io.to(`campaign_${campaignId}`).emit('stats_update', {
        campaignId,
        stats,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error broadcasting stats update:', error);
    }
  };

  io.broadcastStatsUpdate = broadcastStatsUpdate;

  // Auto-broadcast stats for active campaigns every 10 seconds
  setInterval(async () => {
    try {
      const activeCampaigns = await Campaign.find({
        status: { $in: ['running', 'processing'] }
      }).select('_id').lean();
      
      for (const campaign of activeCampaigns) {
        const roomSize = io.sockets.adapter.rooms.get(`campaign_${campaign._id}`)?.size || 0;
        if (roomSize > 0) {
          broadcastStatsUpdate(campaign._id);
        }
      }
    } catch (error) {
      console.error('Error in auto-broadcast:', error);
    }
  }, 10000); // Every 10 seconds

  // Make io globally available for webhook updates
  global.io = io;

  return io;
};