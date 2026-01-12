import mongoose from 'mongoose';
import { Kafka } from 'kafkajs';
import axios from 'axios';
import Bottleneck from 'bottleneck';
import connectDB from '../db/index.js';
import User from '../models/user.model.js';
import { sendDBUpdateToKafka } from '../services/kafka.service.js';

process.env.WORKER_MODE = 'true';

// 🔥 GLOBAL RATE LIMITER - Safe for Jio RBM (66 TPS)
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

let totalSent = 0;
let totalFailed = 0;
let totalRetries = 0;

// 🔥 FIX #4: PRELOAD USERS & TOKENS
const userMap = new Map();
const tokenMap = new Map();

async function preloadUsers() {
  const users = await User.find({ 'jioConfig.isConfigured': true })
    .select('_id jioConfig')
    .lean();
  
  users.forEach(user => {
    userMap.set(user._id.toString(), user);
  });
  
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
    } catch (error) {
      console.error(`[Token] Refresh failed for user ${userId}`);
    }
  }
  console.log(`✅ Refreshed ${tokenMap.size} tokens`);
}

function getUser(userId) {
  return userMap.get(userId);
}

function getAccessToken(userId) {
  const cached = tokenMap.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }
  return null;
}

async function startMessageSender() {
  try {
    await connectDB();
    console.log('✅ Message Sender connected to MongoDB');
    
    // 🔥 FIX #4: Preload users and tokens
    await preloadUsers();
    await refreshTokens();
    
    // Refresh tokens every 50 minutes
    setInterval(refreshTokens, 50 * 60 * 1000);
    
    const kafka = new Kafka({
      clientId: 'message-sender',
      brokers: [process.env.KAFKA_BROKER || 'localhost:9092']
    });
    
    const consumer = kafka.consumer({ 
      groupId: 'message-senders',
      sessionTimeout: 30000,
      heartbeatInterval: 3000
    });
    
    const retryProducer = kafka.producer({
      allowAutoTopicCreation: true,
      maxInFlightRequests: 5,
      retry: { retries: 3, initialRetryTime: 100 }
    });
    
    await consumer.connect();
    await retryProducer.connect();
    await consumer.subscribe({ topic: 'rcs-messages', fromBeginning: true });
    
    console.log('✅ Message Sender subscribed to rcs-messages');
    
    // 🔥 FIX #5: Larger batches, fewer consumers
    await consumer.run({
      partitionsConsumedConcurrently: 5,
      eachBatchAutoResolve: false,
      eachBatch: async ({ batch, resolveOffset, heartbeat }) => {
        const promises = [];
        
        for (const message of batch.messages) {
          const messageData = JSON.parse(message.value.toString());
          
          // 🔥 FIX #2: ACK AFTER send completes
          const promise = sendMessageLimited(messageData)
            .then(result => {
              if (result.success) {
                totalSent++;
              } else {
                const errorType = classifyError(result.statusCode, result.error);
                const policy = RETRY_POLICIES[errorType];
                
                if (policy && (messageData.retryCount || 0) < policy.maxRetries) {
                  const delay = Math.random() * (policy.delayRange[1] - policy.delayRange[0]) + policy.delayRange[0];
                  const delaySeconds = Math.floor(delay / 1000);
                  
                  // 🔥 FIX #3: Route to delay-specific topic
                  const retryTopic = delaySeconds <= 5 ? 'rcs-retries-5s' :
                                    delaySeconds <= 30 ? 'rcs-retries-30s' : 'rcs-retries-2m';
                  
                  retryProducer.send({
                    topic: retryTopic,
                    messages: [{
                      key: messageData.messageId,
                      value: JSON.stringify({
                        ...messageData,
                        retryCount: (messageData.retryCount || 0) + 1,
                        errorType
                      })
                    }]
                  }).catch(() => {});
                  
                  totalRetries++;
                } else {
                  totalFailed++;
                }
              }
              return resolveOffset(message.offset);
            })
            .catch(() => {
              totalFailed++;
              return resolveOffset(message.offset);
            });
          
          promises.push(promise);
        }
        
        await Promise.all(promises);
        await heartbeat();
        
        // Log stats every 1000 messages
        if (totalSent % 1000 === 0 && totalSent > 0) {
          const rate = Math.round(totalSent / ((Date.now() - startTime) / 60000));
          const limiterStats = limiter.counts();
          console.log(`[Sender] Sent: ${totalSent}, Rate: ${rate}/min, Queue: ${limiterStats.EXECUTING}/${limiterStats.QUEUED}`);
        }
      }
    });
    
  } catch (error) {
    console.error('❌ Message sender startup failed:', error);
    process.exit(1);
  }
}

const startTime = Date.now();

async function sendMessage(messageData) {
  const { phoneNumber, messageId, userId, templateType, content, variables, campaignId } = messageData;
  
  try {
    // 🔥 FIX #4: No DB lookup - instant Map access
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
      timeout: 5000
    });
    
    if (response.status === 201) {
      const jioMessageId = response.data?.messageId;
      
      // 🔥 FIX #3: Queue DB update for batching
      sendDBUpdateToKafka({
        messageId,
        campaignId,
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

// 🔥 Wrap sendMessage with rate limiter
const sendMessageLimited = limiter.wrap(sendMessage);

function classifyError(statusCode, errorMessage) {
  if (statusCode === 429) return '429';
  if (errorMessage?.includes('timeout')) return 'timeout';
  if (errorMessage?.includes('connect')) return 'connection';
  return 'other';
}

function buildPayload(templateType, content, variables) {
  if (content && content.content) {
    return content;
  }
  return { content };
}

startMessageSender();
