#!/usr/bin/env node

// Dedicated Background Worker Process
// Usage: node worker.js

import mongoose from 'mongoose';
import Bull from 'bull';
import '../models/campaign.model.js';
import '../models/message.model.js';
import '../models/messageLog.model.js';
import '../models/template.model.js';
import { processWebhookData, processUserInteraction } from '../controller/webhook.controller.js';
import BackgroundWorkerService from '../services/BackgroundWorkerService.js';

// Set worker mode
process.env.WORKER_MODE = 'true';

const MONGODB_URI = process.env.MONGODB_URI;

// Initialize ALL queues with processing
const webhookQueue = new Bull('webhook-processing', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: 100,
    removeOnFail: 50
  }
});

const statsQueue = new Bull('background-stats-sync', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379
  },
  defaultJobOptions: {
    removeOnComplete: 5,
    removeOnFail: 10
  }
});

async function startWorker() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Worker connected to MongoDB');

    // Process webhook jobs from API
    webhookQueue.process('webhook-data', 50, async (job) => {
      const { data, timestamp, requestId } = job.data;
      console.log(`[Worker] Processing ${requestId}`);
      
      const entityType = data?.entityType;
      
      if (entityType === "USER_MESSAGE") {
        await processUserInteraction(data, timestamp);
      } else {
        await processWebhookData(data, timestamp);
      }
      
      console.log(`[Worker] Completed ${requestId}`);
    });

    // Initialize background services with queue processing
    const backgroundWorker = new BackgroundWorkerService(statsQueue);
    console.log('🚀 Background Worker Service started');

    // Graceful shutdown
    const shutdown = async () => {
      console.log('🛑 Shutting down worker...');
      await Promise.all([
        webhookQueue.close(),
        statsQueue.close(),
        mongoose.connection.close()
      ]);
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

  } catch (error) {
    console.error('❌ Worker startup failed:', error);
    process.exit(1);
  }
}

startWorker();