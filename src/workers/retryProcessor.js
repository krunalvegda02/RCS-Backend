import mongoose from 'mongoose';
import { Kafka } from 'kafkajs';
import axios from 'axios';
import Bottleneck from 'bottleneck';
import connectDB from '../db/index.js';
import User from '../models/user.model.js';
import { sendDBUpdateToKafka } from '../services/kafka.service.js';

process.env.WORKER_MODE = 'true';

// 🔥 GLOBAL RATE LIMITER - Shared with messageSender
const limiter = new Bottleneck({
  maxConcurrent: 10,
  minTime: 15,
  reservoir: 4000,
  reservoirRefreshAmount: 4000,
  reservoirRefreshInterval: 60000,
  id: 'jio-rcs-limiter',
  datastore: 'ioredis',
  clientOptions: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379
  }
});

const RETRY_POLICIES = {
  '429': { maxRetries: 50, delayRange: [500, 2000] },
  'timeout': { maxRetries: 100, delayRange: [1000, 3000] },
  'connection': { maxRetries: 3, delayRange: [1000, 2000] }
};

let successAfterRetry = 0;
let finalFailures = 0;
let skippedNotReady = 0;

const userMap = new Map();
const tokenMap = new Map();

async function preloadUsers() {
  const users = await User.find({ 'jioConfig.isConfigured': true }).select('_id jioConfig').lean();
  users.forEach(user => userMap.set(user._id.toString(), user));
  console.log(`✅ Preloaded ${users.length} users`);
}

async function refreshTokens() {
  for (const [userId, user] of userMap.entries()) {
    try {
      const { clientId, clientSecret } = user.jioConfig;
      const url = `https://tgs.businessmessaging.jio.com/v1/oauth/token?grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}&scope=read`;
      const response = await axios.get(url, { timeout: 10000 });
      tokenMap.set(userId, {
        token: response.data.access_token,
        expiresAt: Date.now() + (55 * 60 * 1000)
      });
    } catch (error) {}
  }
}

function getUser(userId) {
  return userMap.get(userId);
}

function getAccessToken(userId) {
  const cached = tokenMap.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  return null;
}

async function startRetryProcessor() {
  try {
    await connectDB();
    console.log('✅ Retry Processor connected to MongoDB');
    
    await preloadUsers();
    await refreshTokens();
    setInterval(refreshTokens, 50 * 60 * 1000);
    
    const kafka = new Kafka({
      clientId: 'retry-processor',
      brokers: [process.env.KAFKA_BROKER || 'localhost:9092']
    });
    
    const consumer = kafka.consumer({ 
      groupId: 'retry-processors',
      sessionTimeout: 30000,
      heartbeatInterval: 3000
    });
    
    const retryProducer = kafka.producer({
      allowAutoTopicCreation: true,
      maxInFlightRequests: 5
    });
    
    await consumer.connect();
    await retryProducer.connect();
    await consumer.subscribe({ 
      topics: ['rcs-retries-5s', 'rcs-retries-30s', 'rcs-retries-2m'],
      fromBeginning: false 
    });
    
    console.log('✅ Retry Processor subscribed to rcs-retries');
    
    await consumer.run({
      partitionsConsumedConcurrently: 5,
      eachBatchAutoResolve: false,
      eachBatch: async ({ batch, resolveOffset, heartbeat }) => {
        const promises = [];
        
        for (const message of batch.messages) {
          const retryData = JSON.parse(message.value.toString());
          
          // 🔥 FIX #1: Delay topics handle timing naturally
          const promise = sendMessageLimited(retryData)
            
            .then(result => {
              if (result.success) {
                successAfterRetry++;
              } else {
                const errorType = classifyError(result.statusCode, result.error);
                const policy = RETRY_POLICIES[errorType];
                
                if (policy && retryData.retryCount < policy.maxRetries) {
                  const delay = Math.random() * (policy.delayRange[1] - policy.delayRange[0]) + policy.delayRange[0];
                  const delaySeconds = Math.floor(delay / 1000);
                  const retryTopic = delaySeconds <= 5 ? 'rcs-retries-5s' :
                                    delaySeconds <= 30 ? 'rcs-retries-30s' : 'rcs-retries-2m';
                  
                  retryProducer.send({
                    topic: retryTopic,
                    messages: [{
                      key: retryData.messageId,
                      value: JSON.stringify({
                        ...retryData,
                        retryCount: retryData.retryCount + 1,
                        errorType
                      })
                    }]
                  }).catch(() => {});
                } else {
                  finalFailures++;
                  markMessageFailed(retryData.messageId, `Max retries: ${result.error}`, retryData.campaignId);
                }
              }
              return resolveOffset(message.offset);
            })
            .catch(error => {
              console.error('[Retry] Error:', error.message);
              return resolveOffset(message.offset);
            });
          
          promises.push(promise);
        }
        
        await Promise.all(promises);
        await heartbeat();
        
        if (successAfterRetry % 50 === 0 && successAfterRetry > 0) {
          console.log(`[Retry] Success: ${successAfterRetry}, Failures: ${finalFailures}, Skipped: ${skippedNotReady}`);
        }
      }
    });
    
  } catch (error) {
    console.error('❌ Retry processor startup failed:', error);
    process.exit(1);
  }
}

async function sendMessage(messageData) {
  const { phoneNumber, messageId, userId, templateType, content, variables } = messageData;
  
  try {
    const user = getUser(userId);
    if (!user?.jioConfig?.isConfigured) {
      return { success: false, error: 'Jio RCS not configured' };
    }
    
    const accessToken = getAccessToken(userId);
    if (!accessToken) {
      return { success: false, error: 'Token not available' };
    }
    
    const assistantId = user.jioConfig.assistantId;
    
    const payload = buildPayload(templateType, content, variables);
    const url = `https://api.businessmessaging.jio.com/v1/messaging/users/${phoneNumber}/assistantMessages/async?messageId=${messageId}&assistantId=${assistantId}`;
    
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      timeout: 8000
    });
    
    if (response.status === 201) {
      const jioMessageId = response.data?.messageId;
      
      sendDBUpdateToKafka({
        messageId,
        campaignId: messageData.campaignId,
        fields: {
          'campaigns.$.rcsMessageId': jioMessageId,
          'campaigns.$.jioMessageId': jioMessageId,
          'campaigns.$.status': 'sent',
          'campaigns.$.sentAt': new Date()
        }
      });
      
      return { success: true };
    }
    
    return { success: false, statusCode: response.status, error: response.data };
    
  } catch (error) {
    return { 
      success: false, 
      statusCode: error.response?.status,
      error: error.message 
    };
  }
}

function classifyError(statusCode, errorMessage) {
  if (statusCode === 429) return '429';
  if (errorMessage?.includes('timeout')) return 'timeout';
  if (errorMessage?.includes('connect')) return 'connection';
  return 'other';
}

function buildPayload(templateType, content, variables) {
  // Content from Kafka is double-nested: { content: { richCardDetails: ... } }
  // Unwrap it to get the actual Jio API payload
  if (content && content.content) {
    return content; // Already in correct format { content: { ... } }
  }
  
  // Fallback: wrap if not already wrapped
  return { content };
}

async function markMessageFailed(messageId, error, campaignId) {
  sendDBUpdateToKafka({
    messageId,
    campaignId,
    fields: {
      'campaigns.$.status': 'failed',
      'campaigns.$.errorMessage': error,
      'campaigns.$.failedAt': new Date()
    }
  });
}

const sendMessageLimited = limiter.wrap(sendMessage);

startRetryProcessor();
