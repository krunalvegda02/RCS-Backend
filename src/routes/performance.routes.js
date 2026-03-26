import express from 'express';
import os from 'os';
import { webhookBuffer } from '../services/webhookBuffer.service.js';

const router = express.Router();

// Performance monitoring endpoint
router.get('/status', (req, res) => {
  const memUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();
  const bufferStatus = webhookBuffer.getStatus();
  
  const stats = {
    server: {
      uptime: Math.floor(process.uptime()),
      nodeVersion: process.version,
      platform: os.platform(),
      arch: os.arch()
    },
    memory: {
      rss: Math.round(memUsage.rss / 1024 / 1024), // MB
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
      external: Math.round(memUsage.external / 1024 / 1024), // MB
      systemTotal: Math.round(os.totalmem() / 1024 / 1024), // MB
      systemFree: Math.round(os.freemem() / 1024 / 1024) // MB
    },
    cpu: {
      user: Math.round(cpuUsage.user / 1000), // ms
      system: Math.round(cpuUsage.system / 1000), // ms
      loadAverage: os.loadavg()
    },
    webhookBuffer: {
      buffered: bufferStatus.buffered,
      overflow: bufferStatus.overflow,
      capacity: bufferStatus.totalCapacity,
      utilization: Math.round((bufferStatus.buffered / bufferStatus.maxSize) * 100),
      dropped: bufferStatus.dropped,
      processing: bufferStatus.processing
    },
    timestamp: new Date().toISOString()
  };
  
  res.json({
    success: true,
    data: stats
  });
});

// Lightweight health check
router.get('/health', (req, res) => {
  const bufferStatus = webhookBuffer.getStatus();
  const memUsage = process.memoryUsage();
  
  const health = {
    status: 'healthy',
    uptime: Math.floor(process.uptime()),
    memory: Math.round(memUsage.heapUsed / 1024 / 1024),
    buffer: bufferStatus.buffered,
    timestamp: Date.now()
  };
  
  // Mark as unhealthy if buffer is overflowing
  if (bufferStatus.buffered > bufferStatus.maxSize * 0.9) {
    health.status = 'warning';
    health.warning = 'Buffer near capacity';
  }
  
  if (bufferStatus.dropped > 0) {
    health.status = 'critical';
    health.error = `${bufferStatus.dropped} webhooks dropped`;
  }
  
  res.json(health);
});

export default router;