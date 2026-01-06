#!/usr/bin/env node

/**
 * Test script to verify capability results are being saved to ContactBatch
 */

import mongoose from 'mongoose';
import ContactBatch from './src/models/contactBatch.model.js';
import jioRCSService from './src/services/JioRCS.service.js';

// Test configuration
const TEST_CONFIG = {
  mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/rcs_messaging',
  testUserId: '695bb14daa33b8b6f21303e6', // Replace with actual user ID
  testCampaignId: '695c72d0d799808416885d6f', // Replace with actual campaign ID
  testPhoneNumbers: [
    '8347006561',
    '7351838534',
    '8416944120'
  ]
};

async function testCapabilitySave() {
  try {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(TEST_CONFIG.mongoUri);
    console.log('✅ Connected to MongoDB');

    // Create a test batch
    console.log('📝 Creating test ContactBatch...');
    const testBatch = await ContactBatch.create({
      campaignId: TEST_CONFIG.testCampaignId,
      userId: TEST_CONFIG.testUserId,
      batchNumber: Date.now(), // Use timestamp as unique batch number
      phoneNumbers: TEST_CONFIG.testPhoneNumbers,
      totalContacts: TEST_CONFIG.testPhoneNumbers.length,
      status: 'pending'
    });
    console.log('✅ Test batch created:', testBatch._id);

    // Test capability check with save
    console.log('🔍 Testing capability check with save...');
    const results = await jioRCSService.checkCapabilityBatchWithSave(
      TEST_CONFIG.testPhoneNumbers,
      TEST_CONFIG.testUserId,
      TEST_CONFIG.testCampaignId,
      testBatch.batchNumber
    );

    console.log('📊 Capability check results:', {
      total: results.length,
      rcsCapable: results.filter(r => r.isCapable).length,
      notCapable: results.filter(r => !r.isCapable).length
    });

    // Verify results were saved
    console.log('🔍 Verifying results were saved to database...');
    const updatedBatch = await ContactBatch.findById(testBatch._id);
    
    console.log('📋 Updated batch status:', updatedBatch.status);
    console.log('📊 Capability results count:', updatedBatch.capabilityResults.length);
    console.log('🎯 RCS capable count:', updatedBatch.rcsCapableCount);
    console.log('📱 Processed contacts:', updatedBatch.processedContacts);

    if (updatedBatch.capabilityResults.length > 0) {
      console.log('✅ SUCCESS: Capability results saved to database!');
      console.log('📋 Sample results:');
      updatedBatch.capabilityResults.slice(0, 3).forEach((result, index) => {
        console.log(`  ${index + 1}. ${result.phoneNumber} - RCS: ${result.isRcsCapable}`);
      });
    } else {
      console.log('❌ FAILURE: No capability results found in database');
    }

    // Cleanup
    console.log('🧹 Cleaning up test data...');
    await ContactBatch.findByIdAndDelete(testBatch._id);
    console.log('✅ Test data cleaned up');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
    process.exit(0);
  }
}

// Run the test
testCapabilitySave();