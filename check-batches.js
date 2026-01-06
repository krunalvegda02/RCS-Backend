#!/usr/bin/env node

/**
 * Utility script to check existing ContactBatch documents
 */

import mongoose from 'mongoose';
import ContactBatch from './src/models/contactBatch.model.js';

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/rcs_messaging';

async function checkContactBatches() {
  try {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Get all ContactBatch documents
    const batches = await ContactBatch.find({})
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    console.log(`📊 Found ${batches.length} ContactBatch documents (showing latest 10):`);
    console.log('=' .repeat(80));

    batches.forEach((batch, index) => {
      console.log(`\n${index + 1}. Batch ID: ${batch._id}`);
      console.log(`   Campaign ID: ${batch.campaignId}`);
      console.log(`   User ID: ${batch.userId}`);
      console.log(`   Batch Number: ${batch.batchNumber}`);
      console.log(`   Status: ${batch.status}`);
      console.log(`   Total Contacts: ${batch.totalContacts}`);
      console.log(`   Processed Contacts: ${batch.processedContacts}`);
      console.log(`   RCS Capable Count: ${batch.rcsCapableCount}`);
      console.log(`   Phone Numbers Count: ${batch.phoneNumbers?.length || 0}`);
      console.log(`   Capability Results Count: ${batch.capabilityResults?.length || 0}`);
      console.log(`   Created: ${batch.createdAt}`);
      console.log(`   Updated: ${batch.updatedAt}`);
      
      if (batch.capabilityResults && batch.capabilityResults.length > 0) {
        console.log(`   ✅ HAS CAPABILITY RESULTS`);
        console.log(`   Sample results:`);
        batch.capabilityResults.slice(0, 3).forEach((result, i) => {
          console.log(`     ${i + 1}. ${result.phoneNumber} - RCS: ${result.isRcsCapable}`);
        });
      } else {
        console.log(`   ❌ NO CAPABILITY RESULTS`);
      }
    });

    // Get summary statistics
    const totalBatches = await ContactBatch.countDocuments({});
    const completedBatches = await ContactBatch.countDocuments({ status: 'completed' });
    const batchesWithResults = await ContactBatch.countDocuments({ 
      'capabilityResults.0': { $exists: true } 
    });

    console.log('\n' + '=' .repeat(80));
    console.log('📈 SUMMARY STATISTICS:');
    console.log(`   Total Batches: ${totalBatches}`);
    console.log(`   Completed Batches: ${completedBatches}`);
    console.log(`   Batches with Capability Results: ${batchesWithResults}`);
    console.log(`   Batches missing Results: ${totalBatches - batchesWithResults}`);

    if (batchesWithResults === 0) {
      console.log('\n❌ ISSUE DETECTED: No batches have capability results saved!');
      console.log('   This confirms the issue you reported.');
    } else {
      console.log('\n✅ Some batches have capability results saved.');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
    process.exit(0);
  }
}

// Run the check
checkContactBatches();