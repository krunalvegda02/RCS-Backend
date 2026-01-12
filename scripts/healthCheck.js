#!/usr/bin/env node

import { Kafka } from 'kafkajs';
import mongoose from 'mongoose';
import connectDB from '../src/db/index.js';

const KAFKA_BROKER = process.env.KAFKA_BROKER || 'localhost:9092';
const REQUIRED_TOPICS = [
  'rcs-webhooks',
  'message-log-processing', 
  'campaign-batch-entries'
];

async function checkKafkaHealth() {
  console.log('🔍 Checking Kafka health...');
  
  try {
    const kafka = new Kafka({
      clientId: 'health-checker',
      brokers: [KAFKA_BROKER],
      connectionTimeout: 5000,
      requestTimeout: 10000
    });
    
    const admin = kafka.admin();
    await admin.connect();
    
    // Check if topics exist
    const topics = await admin.listTopics();
    console.log('📋 Available topics:', topics);
    
    const missingTopics = REQUIRED_TOPICS.filter(topic => !topics.includes(topic));
    if (missingTopics.length > 0) {
      console.log('⚠️  Missing topics:', missingTopics);
      
      // Create missing topics
      await admin.createTopics({
        topics: missingTopics.map(topic => ({
          topic,
          numPartitions: 3,
          replicationFactor: 1
        }))
      });
      console.log('✅ Created missing topics');
    }
    
    await admin.disconnect();
    console.log('✅ Kafka is healthy');
    return true;
  } catch (error) {
    console.error('❌ Kafka health check failed:', error.message);
    return false;
  }
}

async function checkDatabaseHealth() {
  console.log('🔍 Checking Database health...');
  
  try {
    await connectDB();
    
    // Test collections
    const collections = ['users', 'contact_campaign_messages', 'message_logs'];
    for (const collection of collections) {
      const count = await mongoose.connection.db.collection(collection).countDocuments({}, { limit: 1 });
      console.log(`📊 Collection ${collection}: ${count > 0 ? 'OK' : 'Empty'}`);
    }
    
    console.log('✅ Database is healthy');
    return true;
  } catch (error) {
    console.error('❌ Database health check failed:', error.message);
    return false;
  }
}

async function checkProcessAlignment() {
  console.log('🔍 Checking Process Alignment...');
  
  const issues = [];
  
  // Check if all required models exist
  try {
    const MessageLog = (await import('../src/models/messageLog.model.js')).default;
    const ContactCampaignMessage = (await import('../src/models/contact_campaign_message.model.js')).default;
    const User = (await import('../src/models/user.model.js')).default;
    
    console.log('✅ All models loaded successfully');
  } catch (error) {
    issues.push(`Model loading error: ${error.message}`);
  }
  
  // Check if services exist
  try {
    await import('../src/services/kafka.service.js');
    await import('../src/services/MessageLogProcessor.js');
    console.log('✅ All services loaded successfully');
  } catch (error) {
    issues.push(`Service loading error: ${error.message}`);
  }
  
  if (issues.length > 0) {
    console.error('❌ Process alignment issues:', issues);
    return false;
  }
  
  console.log('✅ Process alignment is correct');
  return true;
}

async function runHealthCheck() {
  console.log('🏥 Starting Production Process Health Check...\n');
  
  const checks = [
    { name: 'Kafka', fn: checkKafkaHealth },
    { name: 'Database', fn: checkDatabaseHealth },
    { name: 'Process Alignment', fn: checkProcessAlignment }
  ];
  
  const results = {};
  
  for (const check of checks) {
    console.log(`\n--- ${check.name} Health Check ---`);
    results[check.name] = await check.fn();
  }
  
  console.log('\n📊 Health Check Summary:');
  console.log('========================');
  
  let allHealthy = true;
  for (const [name, status] of Object.entries(results)) {
    console.log(`${status ? '✅' : '❌'} ${name}: ${status ? 'HEALTHY' : 'UNHEALTHY'}`);
    if (!status) allHealthy = false;
  }
  
  console.log(`\n🎯 Overall Status: ${allHealthy ? '✅ ALL SYSTEMS HEALTHY' : '❌ ISSUES DETECTED'}`);
  
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.close();
  }
  
  process.exit(allHealthy ? 0 : 1);
}

runHealthCheck().catch(error => {
  console.error('💥 Health check crashed:', error);
  process.exit(1);
});