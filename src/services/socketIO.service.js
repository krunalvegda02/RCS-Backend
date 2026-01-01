import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import statsService from './CampaignStatsService.js';

export const setupSocketIO = (server) => {
  const io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || process.env.CORS_ORIGIN,
      methods: ["GET", "POST"],
      credentials: true
    }
  });

  // Authentication middleware for Socket.IO
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication error'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded._id || decoded.userId;
      socket.join(`user_${socket.userId}`);
      
      console.log(`[Socket] User ${socket.userId} connected`);
      next();
    } catch (error) {
      console.error('[Socket] Auth error:', error.message);
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    // Join campaign room for real-time updates
    socket.on('join_campaign', (campaignId) => {
      socket.join(`campaign_${campaignId}`);
      console.log(`[Socket] User ${socket.userId} joined campaign ${campaignId}`);
    });

    // Leave campaign room
    socket.on('leave_campaign', (campaignId) => {
      socket.leave(`campaign_${campaignId}`);
      console.log(`[Socket] User ${socket.userId} left campaign ${campaignId}`);
    });

    // Request real-time stats
    socket.on('request_stats', async (campaignId) => {
      try {
        const stats = await statsService.getCampaignStats(campaignId);
        socket.emit('stats_update', {
          campaignId,
          stats,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error('[Socket] Error fetching stats:', error);
        socket.emit('error', { message: 'Failed to fetch stats' });
      }
    });

    // Request all user campaigns stats
    socket.on('request_user_stats', async (userId) => {
      try {
        const userStats = await statsService.getUserCampaignStats(userId);
        socket.emit('user_stats_update', {
          userId,
          stats: userStats,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error('[Socket] Error fetching user stats:', error);
        socket.emit('error', { message: 'Failed to fetch user stats' });
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Socket] Client disconnected: ${socket.id}`);
    });
  });

  // Helper functions for webhook updates
  io.emitCampaignUpdate = (campaignId, updateData) => {
    io.to(`campaign_${campaignId}`).emit('campaign_update', {
      campaignId,
      ...updateData,
      timestamp: new Date().toISOString()
    });
  };

  io.emitMessageStatusUpdate = (campaignId, messageData) => {
    io.to(`campaign_${campaignId}`).emit('message_status_update', {
      campaignId,
      ...messageData,
      timestamp: new Date().toISOString()
    });
  };

  io.emitUserInteraction = (campaignId, interactionData) => {
    io.to(`campaign_${campaignId}`).emit('user_interaction', {
      campaignId,
      ...interactionData,
      timestamp: new Date().toISOString()
    });
  };

  // Make io globally available for webhook updates
  global.io = io;

  return io;
};