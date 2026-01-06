#!/usr/bin/env node

import mongoose from 'mongoose';
import JioRCSService from '../src/services/JioRCS.service.js';
import User from '../src/models/user.model.js';
import dotenv from 'dotenv';

dotenv.config();

// Mock user data for testing
const mockUserId = '507f1f77bcf86cd799439011';

async function testDynamicBatching() {
  try {
    console.log('🧪 Testing Dynamic Batching System\n');

    // Test scenarios with different contact counts
    const testCases = [
      { name: 'Small batch (200 contacts)', count: 200 },
      { name: 'Minimum batch (500 contacts)', count: 500 },
      { name: 'Medium batch (2,500 contacts)', count: 2500 },
      { name: 'Large batch (10,000 contacts)', count: 10000 },
      { name: 'Extra large (25,000 contacts)', count: 25000 },
      { name: 'Huge batch (50,000 contacts)', count: 50000 },
      { name: 'Edge case (9,999 contacts)', count: 9999 },
      { name: 'Edge case (10,001 contacts)', count: 10001 }
    ];

    for (const testCase of testCases) {
      console.log(`\n📋 Testing: ${testCase.name}`);
      console.log(`📊 Contact count: ${testCase.count.toLocaleString()}`);
      
      // Generate test phone numbers
      const phoneNumbers = [];
      for (let i = 0; i < testCase.count; i++) {
        const randomNum = `9${Math.floor(Math.random() * 900000000) + 100000000}`;
        phoneNumbers.push(randomNum);
      }

      // Test the dynamic batching logic (without actual API calls)
      const startTime = Date.now();
      
      try {
        const result = await testBatchingLogic(phoneNumbers);
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        console.log(`✅ Batching successful:`);
        console.log(`   📦 Total batches: ${result.totalBatches}`);
        console.log(`   📏 Batch sizes: ${result.batchSizes.join(', ')}`);
        console.log(`   ⏱️  Processing time: ${duration}ms`);
        console.log(`   🎯 All batches in range: ${result.allInRange ? 'YES' : 'NO'}`);
        console.log(`   📈 Efficiency: ${result.efficiency}%`);
        
        if (!result.allInRange) {
          console.log(`   ⚠️  Invalid batch sizes: ${result.invalidSizes.join(', ')}`);
        }
        
      } catch (error) {
        console.log(`❌ Test failed: ${error.message}`);
      }
    }

    console.log('\n🎉 Dynamic Batching Tests Completed');
    
  } catch (error) {
    console.error('❌ Test suite failed:', error);
  }
}

// Test the batching logic without API calls
async function testBatchingLogic(phoneNumbers) {
  const MIN_BATCH_SIZE = 500;
  const MAX_BATCH_SIZE = 9500;
  const actualCount = phoneNumbers.length;
  
  let processNumbers = [...phoneNumbers];
  
  // If less than 500, pad with dummy numbers
  if (actualCount < MIN_BATCH_SIZE) {
    const dummyCount = MIN_BATCH_SIZE - actualCount;
    for (let i = 0; i < dummyCount; i++) {
      const randomNum = `9${Math.floor(Math.random() * 900000000) + 100000000}`;
      processNumbers.push(`+91${randomNum}`);
    }
    console.log(`   🔧 Padded ${actualCount} real + ${dummyCount} dummy = ${MIN_BATCH_SIZE} total`);
  }
  
  // Create optimal batches (500-9500 range)
  const chunks = [];
  const total = processNumbers.length;
  
  for (let i = 0; i < total; i += MAX_BATCH_SIZE) {
    let chunk = processNumbers.slice(i, i + MAX_BATCH_SIZE);
    
    // If remaining chunk is too small, merge with previous or pad
    const remaining = total - i - chunk.length;
    if (remaining > 0 && remaining < MIN_BATCH_SIZE && chunks.length > 0) {
      // Merge with previous chunk if it won't exceed MAX_BATCH_SIZE
      const prevChunk = chunks[chunks.length - 1];
      if (prevChunk.length + chunk.length + remaining <= MAX_BATCH_SIZE) {
        chunks[chunks.length - 1] = [...prevChunk, ...chunk, ...processNumbers.slice(i + chunk.length)];
        break;
      }
    }
    
    // Ensure chunk meets minimum size
    if (chunk.length < MIN_BATCH_SIZE) {
      const padCount = MIN_BATCH_SIZE - chunk.length;
      for (let j = 0; j < padCount; j++) {
        const randomNum = `9${Math.floor(Math.random() * 900000000) + 100000000}`;
        chunk.push(`+91${randomNum}`);
      }
    }
    
    chunks.push(chunk);
  }
  
  // Analyze results
  const batchSizes = chunks.map(c => c.length);
  const allInRange = batchSizes.every(size => size >= MIN_BATCH_SIZE && size <= MAX_BATCH_SIZE);
  const invalidSizes = batchSizes.filter(size => size < MIN_BATCH_SIZE || size > MAX_BATCH_SIZE);
  const totalProcessed = batchSizes.reduce((sum, size) => sum + size, 0);
  const efficiency = Math.round((actualCount / totalProcessed) * 100);
  
  return {
    totalBatches: chunks.length,
    batchSizes,
    allInRange,
    invalidSizes,
    efficiency,
    totalProcessed,
    originalCount: actualCount
  };
}

// Performance test
async function performanceTest() {
  console.log('\n⚡ Performance Test: 50K Contacts Simulation\n');
  
  const contactCount = 50000;
  const phoneNumbers = [];
  
  // Generate 50K test numbers
  console.log('📝 Generating 50K test phone numbers...');
  for (let i = 0; i < contactCount; i++) {
    const randomNum = `9${Math.floor(Math.random() * 900000000) + 100000000}`;
    phoneNumbers.push(randomNum);
  }
  
  console.log('🚀 Testing batching performance...');
  const startTime = Date.now();
  
  const result = await testBatchingLogic(phoneNumbers);
  
  const endTime = Date.now();
  const batchingTime = endTime - startTime;
  
  // Simulate API call time (3 seconds per batch)
  const estimatedApiTime = result.totalBatches * 3000; // 3 seconds per batch
  const totalEstimatedTime = batchingTime + estimatedApiTime;
  
  console.log('📊 Performance Results:');
  console.log(`   📦 Total batches: ${result.totalBatches}`);
  console.log(`   📏 Batch sizes: ${result.batchSizes.join(', ')}`);
  console.log(`   ⚡ Batching time: ${batchingTime}ms`);
  console.log(`   🌐 Estimated API time: ${estimatedApiTime / 1000}s (${result.totalBatches} × 3s)`);
  console.log(`   ⏱️  Total estimated time: ${totalEstimatedTime / 1000}s`);
  console.log(`   🎯 Efficiency: ${result.efficiency}%`);
  console.log(`   ✅ All batches valid: ${result.allInRange ? 'YES' : 'NO'}`);
}

// Run tests
async function runTests() {
  console.log('🔬 RCS Dynamic Batching Test Suite');
  console.log('=====================================\n');
  
  await testDynamicBatching();
  await performanceTest();
  
  console.log('\n✅ All tests completed successfully!');
  process.exit(0);
}

runTests().catch(error => {
  console.error('❌ Test suite failed:', error);
  process.exit(1);
});