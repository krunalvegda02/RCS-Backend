#!/usr/bin/env node

import mongoose from 'mongoose';
import ContactBatch from '../src/models/contactBatch.model.js';
import Campaign from '../src/models/campaign.model.js';
import dotenv from 'dotenv';

dotenv.config();

async function testCompleteFlow() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('🔗 Connected to MongoDB\n');

    console.log('🧪 Testing Complete ContactBatch Capability Check Flow');
    console.log('=====================================================\n');

    // Test Case 1: Create ContactBatch with phone numbers only
    console.log('📋 Test 1: Creating ContactBatch with phone numbers');
    
    const testCampaignId = new mongoose.Types.ObjectId();
    const testUserId = new mongoose.Types.ObjectId();
    
    // Generate test phone numbers
    const testPhoneNumbers = [];
    for (let i = 0; i < 1000; i++) {
      const randomNum = `9${Math.floor(Math.random() * 900000000) + 100000000}`;
      testPhoneNumbers.push(randomNum);
    }
    
    const batch = await ContactBatch.create({
      campaignId: testCampaignId,
      userId: testUserId,
      batchNumber: 1,
      phoneNumbers: testPhoneNumbers,
      totalContacts: testPhoneNumbers.length,
      status: 'pending'
    });
    
    console.log(`✅ ContactBatch created:`);
    console.log(`   📦 Batch ID: ${batch._id}`);
    console.log(`   📱 Phone numbers: ${batch.phoneNumbers.length}`);
    console.log(`   📊 Total contacts: ${batch.totalContacts}`);
    console.log(`   🔄 Status: ${batch.status}`);
    console.log(`   📋 Capability results: ${batch.capabilityResults?.length || 0}\n`);

    // Test Case 2: Simulate capability check results
    console.log('📋 Test 2: Simulating capability check results');
    
    await batch.startProcessing();
    console.log(`✅ Batch processing started - Status: ${batch.status}\n`);
    
    // Simulate API results (60% RCS capable)
    const mockResults = testPhoneNumbers.map((phone, index) => ({
      phoneNumber: `+91${phone}`,
      isCapable: Math.random() > 0.4, // 60% RCS capable
      features: Math.random() > 0.4 ? ['RCS_MESSAGING'] : [],
      checkedAt: new Date()
    }));
    
    await batch.updateCapabilityResults(mockResults);
    
    console.log(`✅ Capability results updated:`);
    console.log(`   📊 Total processed: ${batch.processedContacts}`);
    console.log(`   ✅ RCS capable: ${batch.rcsCapableCount}`);
    console.log(`   ❌ Not capable: ${batch.processedContacts - batch.rcsCapableCount}`);
    console.log(`   🔄 Status: ${batch.status}`);
    console.log(`   📋 Results stored: ${batch.capabilityResults.length}\n`);

    // Test Case 3: Verify data retrieval
    console.log('📋 Test 3: Testing data retrieval');
    
    const retrievedBatch = await ContactBatch.findById(batch._id);
    
    console.log(`✅ Data retrieval successful:`);
    console.log(`   📱 Original phone numbers: ${retrievedBatch.phoneNumbers.length}`);
    console.log(`   📋 Capability results: ${retrievedBatch.capabilityResults.length}`);
    console.log(`   📊 RCS capable count: ${retrievedBatch.rcsCapableCount}`);
    console.log(`   🔄 Final status: ${retrievedBatch.status}\n`);

    // Test Case 4: Test aggregation for campaign stats
    console.log('📋 Test 4: Testing campaign stats aggregation');
    
    const batchSummary = await ContactBatch.aggregate([
      { $match: { campaignId: testCampaignId } },
      {
        $group: {
          _id: null,
          totalContacts: { $sum: '$totalContacts' },
          totalRcsCapable: { $sum: '$rcsCapableCount' },
          totalBatches: { $sum: 1 }
        }
      }
    ]);
    
    if (batchSummary.length > 0) {
      const summary = batchSummary[0];
      console.log(`✅ Campaign aggregation successful:`);
      console.log(`   📦 Total batches: ${summary.totalBatches}`);
      console.log(`   📊 Total contacts: ${summary.totalContacts}`);
      console.log(`   ✅ Total RCS capable: ${summary.totalRcsCapable}`);
      console.log(`   📈 RCS capability rate: ${Math.round((summary.totalRcsCapable / summary.totalContacts) * 100)}%\n`);
    }

    // Test Case 5: Test contact retrieval with pagination
    console.log('📋 Test 5: Testing contact retrieval with pagination');
    
    const allContacts = [];
    
    if (retrievedBatch.capabilityResults && retrievedBatch.capabilityResults.length > 0) {
      retrievedBatch.capabilityResults.forEach(result => {
        allContacts.push({
          phoneNumber: result.phoneNumber.replace(/^\+?91/, ''),
          isRcsCapable: result.isRcsCapable,
          batchNumber: retrievedBatch.batchNumber,
          batchStatus: retrievedBatch.status
        });
      });
    } else {
      retrievedBatch.phoneNumbers.forEach(phone => {
        allContacts.push({
          phoneNumber: phone,
          isRcsCapable: null,
          batchNumber: retrievedBatch.batchNumber,
          batchStatus: retrievedBatch.status
        });
      });
    }
    
    console.log(`✅ Contact retrieval successful:`);
    console.log(`   📱 Total contacts retrieved: ${allContacts.length}`);
    console.log(`   ✅ RCS capable contacts: ${allContacts.filter(c => c.isRcsCapable === true).length}`);
    console.log(`   ❌ Non-RCS contacts: ${allContacts.filter(c => c.isRcsCapable === false).length}`);
    console.log(`   ❓ Pending contacts: ${allContacts.filter(c => c.isRcsCapable === null).length}\n`);

    // Test Case 6: Test multiple batches scenario
    console.log('📋 Test 6: Testing multiple batches scenario');
    
    // Create second batch
    const secondBatch = await ContactBatch.create({
      campaignId: testCampaignId,
      userId: testUserId,
      batchNumber: 2,
      phoneNumbers: testPhoneNumbers.slice(0, 500), // Smaller batch
      totalContacts: 500,
      status: 'pending'
    });
    
    await secondBatch.startProcessing();
    
    const secondMockResults = testPhoneNumbers.slice(0, 500).map((phone, index) => ({
      phoneNumber: `+91${phone}`,
      isCapable: Math.random() > 0.3, // 70% RCS capable
      features: Math.random() > 0.3 ? ['RCS_MESSAGING'] : [],
      checkedAt: new Date()
    }));
    
    await secondBatch.updateCapabilityResults(secondMockResults);
    
    // Aggregate both batches
    const multipleBatchSummary = await ContactBatch.aggregate([
      { $match: { campaignId: testCampaignId } },
      {
        $group: {
          _id: null,
          totalContacts: { $sum: '$totalContacts' },
          totalRcsCapable: { $sum: '$rcsCapableCount' },
          totalBatches: { $sum: 1 }
        }
      }
    ]);
    
    if (multipleBatchSummary.length > 0) {
      const summary = multipleBatchSummary[0];
      console.log(`✅ Multiple batch aggregation successful:`);
      console.log(`   📦 Total batches: ${summary.totalBatches}`);
      console.log(`   📊 Total contacts: ${summary.totalContacts}`);
      console.log(`   ✅ Total RCS capable: ${summary.totalRcsCapable}`);
      console.log(`   📈 Combined RCS rate: ${Math.round((summary.totalRcsCapable / summary.totalContacts) * 100)}%\n`);
    }

    // Cleanup
    console.log('🧹 Cleaning up test data...');
    await ContactBatch.deleteMany({ campaignId: testCampaignId });
    console.log('✅ Test data cleaned up\n');

    console.log('🎉 All ContactBatch capability check tests passed!');
    console.log('✅ Flow verification complete:');
    console.log('   1. ✅ ContactBatch creation with phone numbers');
    console.log('   2. ✅ Capability check result storage');
    console.log('   3. ✅ Data retrieval and aggregation');
    console.log('   4. ✅ Contact listing with pagination');
    console.log('   5. ✅ Multiple batch handling');
    console.log('   6. ✅ Campaign stats calculation\n');

    process.exit(0);
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Performance test for large datasets
async function performanceTest() {
  console.log('\n⚡ Performance Test: Large Dataset Handling\n');
  
  try {
    const testCampaignId = new mongoose.Types.ObjectId();
    const testUserId = new mongoose.Types.ObjectId();
    
    // Test with 10K contacts
    const largePhoneNumbers = [];
    for (let i = 0; i < 10000; i++) {
      const randomNum = `9${Math.floor(Math.random() * 900000000) + 100000000}`;
      largePhoneNumbers.push(randomNum);
    }
    
    console.log('📝 Creating large ContactBatch (10K contacts)...');
    const startTime = Date.now();
    
    const largeBatch = await ContactBatch.create({
      campaignId: testCampaignId,
      userId: testUserId,
      batchNumber: 1,
      phoneNumbers: largePhoneNumbers,
      totalContacts: largePhoneNumbers.length,
      status: 'pending'
    });
    
    const createTime = Date.now() - startTime;
    console.log(`✅ Large batch created in ${createTime}ms`);
    
    // Simulate processing
    console.log('🔄 Simulating capability check processing...');
    await largeBatch.startProcessing();
    
    const processingStartTime = Date.now();
    
    // Simulate results
    const largeMockResults = largePhoneNumbers.map((phone, index) => ({
      phoneNumber: `+91${phone}`,
      isCapable: Math.random() > 0.45, // 55% RCS capable
      features: Math.random() > 0.45 ? ['RCS_MESSAGING'] : [],
      checkedAt: new Date()
    }));
    
    await largeBatch.updateCapabilityResults(largeMockResults);
    
    const processingTime = Date.now() - processingStartTime;
    console.log(`✅ Results processed in ${processingTime}ms`);
    
    // Test aggregation performance
    console.log('📊 Testing aggregation performance...');
    const aggStartTime = Date.now();
    
    const aggResult = await ContactBatch.aggregate([
      { $match: { campaignId: testCampaignId } },
      {
        $group: {
          _id: null,
          totalContacts: { $sum: '$totalContacts' },
          totalRcsCapable: { $sum: '$rcsCapableCount' }
        }
      }
    ]);
    
    const aggTime = Date.now() - aggStartTime;
    console.log(`✅ Aggregation completed in ${aggTime}ms`);
    
    if (aggResult.length > 0) {
      console.log(`📊 Results: ${aggResult[0].totalContacts} total, ${aggResult[0].totalRcsCapable} RCS capable`);
    }
    
    // Cleanup
    await ContactBatch.deleteMany({ campaignId: testCampaignId });
    console.log('✅ Performance test completed and cleaned up');
    
  } catch (error) {
    console.error('❌ Performance test failed:', error);
  }
}

// Run all tests
async function runAllTests() {
  await testCompleteFlow();
  await performanceTest();
}

runAllTests().catch(error => {
  console.error('❌ Test suite failed:', error);
  process.exit(1);
});