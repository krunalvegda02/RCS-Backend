#!/usr/bin/env node

// Background Worker Process - Run separately from main API server
// Usage: node worker.js

import mongoose from 'mongoose';
import BackgroundWorkerService from '../services/BackgroundWorkerService.js';
import '../models/campaign.model.js';
import '../models/message.model.js';
import '../models/template.model.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/rcs_messaging';

async function startWorker() {
  try {
    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Worker connected to MongoDB');

    // Initialize background worker service
    console.log('🚀 Background Worker Service started');
    console.log('📊 Processing campaigns, syncing stats, and cleaning up data...');

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