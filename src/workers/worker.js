#!/usr/bin/env node

// Background Worker Process - Run separately from main API server
// Usage: WORKER_MODE=true node worker.js

import mongoose from 'mongoose';
import BackgroundWorkerService from '../services/BackgroundWorkerService.js';
import '../models/campaign.model.js';
import '../models/message.model.js';
import '../models/messageLog.model.js';
import '../models/template.model.js';

// Set worker mode to prevent CampaignStatsService auto-sync
process.env.WORKER_MODE = 'true';

const MONGODB_URI = process.env.MONGODB_URI;

async function startWorker() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Worker connected to MongoDB');

    // Initialize background worker service (now properly instantiated)
    const worker = new BackgroundWorkerService();
    console.log('🚀 Background Worker Service started');
    console.log('📊 Processing stats sync and data cleanup...');

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      console.log('🛑 Shutting down worker...');
      await mongoose.connection.close();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      console.log('🛑 Shutting down worker...');
      await mongoose.connection.close();
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Worker startup failed:', error);
    process.exit(1);
  }
}

startWorker();