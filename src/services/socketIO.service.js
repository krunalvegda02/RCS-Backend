import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

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
    // Join campaign room for live updates
    socket.on('join_campaign', (campaignId) => {
      socket.join(`campaign_${campaignId}`);
    });

    socket.on('leave_campaign', (campaignId) => {
      socket.leave(`campaign_${campaignId}`);
    });

    socket.on('disconnect', () => {
      // Client disconnected
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

  // Make io globally available for webhook updates
  global.io = io;

  return io;
};