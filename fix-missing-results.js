#!/usr/bin/env node

/**
 * Script to fix existing ContactBatch documents that are missing capability results
 */

import mongoose from 'mongoose';
import jioRCSService from './src/services/JioRCS.service.js';

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/rcs_messaging';

async function fixMissingResults() {
  try {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    console.log('🔧 Starting to fix missing capability results...');
    
    // Fix all batches (you can specify campaignId or userId if needed)
    const result = await jioRCSService.fixMissingCapabilityResults();
    
    console.log('📊 Fix Results:');
    console.log(`   Fixed: ${result.fixed} batches`);
    console.log(`   Total: ${result.total} batches needed fixing`);
    
    if (result.fixed > 0) {
      console.log('✅ SUCCESS: Fixed missing capability results!');
    } else if (result.total === 0) {
      console.log('ℹ️  INFO: No batches needed fixing');
    } else {
      console.log('⚠️  WARNING: Some batches could not be fixed');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack trace:', error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
    process.exit(0);
  }
}

// Run the fix
fixMissingResults();