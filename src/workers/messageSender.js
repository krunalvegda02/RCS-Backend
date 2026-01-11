import mongoose from 'mongoose';
import { Kafka } from 'kafkajs';
import axios from 'axios';
import connectDB from '../db/index.js';
import ContactCampaignMessage from '../models/message.model.js';
import User from '../models/user.model.js';

process.env.WORKER_MODE = 'true';

// Retry policies (matching Python script)
const RETRY_POLICIES = {
  '429': { maxRetries: 50, delayRange: [500, 2000] }, // Limit 429 retries to 50
  'timeout': { maxRetries: 100, delayRange: [1000, 3000] },
  'connection': { maxRetries: 3, delayRange: [1000, 2000] }
};

let totalSent = 0;
let totalFailed = 0;
let total429 = 0;
let totalTimeout = 0;
let totalRetries = 0;

// Token cache: { userId: { token, expiresAt } }
const tokenCache = new Map();
// User cache: { userId: { user, cachedAt } }
const userCache = new Map();

async function getUser(userId) {
  const cached = userCache.get(userId);
  if (cached && (Date.now() - cached.cachedAt) < 300000) { // 5 min cache
    return cached.user;
  }
  
  const user = await User.findById(userId).select('+jioConfig.clientSecret');
  userCache.set(userId, { user, cachedAt: Date.now() });
  return user;
}

async function getAccessToken(jioConfig, userId) {
  // Check cache first
  const cached = tokenCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }
  
  // Fetch new token
  const { clientId, clientSecret } = jioConfig;
  const url = `https://tgs.businessmessaging.jio.com/v1/oauth/token?grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}&scope=read`;
  const response = await axios.get(url, { timeout: 10000 });
  const token = response.data.access_token;
  
  // Cache for 55 minutes (tokens usually valid for 1 hour)
  tokenCache.set(userId, {
    token,
    expiresAt: Date.now() + (55 * 60 * 1000)
  });
  
  return token;
}

async function startMessageSender() {
  try {
    await connectDB();
    console.log('✅ Message Sender connected to MongoDB');
    
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
      maxInFlightRequests: 100,
      compression: 0
    });
    
    await consumer.connect();
    await retryProducer.connect();
    await consumer.subscribe({ topic: 'rcs-messages', fromBeginning: true });
    
    console.log('✅ Message Sender subscribed to rcs-messages');
    
    await consumer.run({
      partitionsConsumedConcurrently: 50,
      eachBatchAutoResolve: false,
      eachBatch: async ({ batch, resolveOffset, heartbeat }) => {
        const messages = batch.messages;
        
        // Process all messages without waiting
        messages.forEach(message => {
          const messageData = JSON.parse(message.value.toString());
          
          sendMessage(messageData).then(result => {
            if (result.success) {
              totalSent++;
            } else {
              const errorType = classifyError(result.statusCode, result.error);
              const policy = RETRY_POLICIES[errorType];
              
              if (policy && messageData.retryCount < policy.maxRetries) {
                const delay = Math.random() * (policy.delayRange[1] - policy.delayRange[0]) + policy.delayRange[0];
                
                retryProducer.send({
                  topic: 'rcs-retries',
                  messages: [{
                    key: messageData.messageId,
                    value: JSON.stringify({
                      ...messageData,
                      retryCount: (messageData.retryCount || 0) + 1,
                      errorType,
                      retryAfter: Date.now() + delay
                    })
                  }]
                }).catch(() => {});
                
                totalRetries++;
              } else {
                totalFailed++;
              }
            }
          }).catch(() => {
            totalFailed++;
          });
          
          resolveOffset(message.offset).catch(() => {});
        });
        
        await heartbeat();
        
        // Log stats every 1000 messages
        if (totalSent % 1000 === 0 && totalSent > 0) {
          const rate = Math.round(totalSent / ((Date.now() - startTime) / 60000));
          console.log(`[Sender] Sent: ${totalSent}, Rate: ${rate}/min`);
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
    const user = await getUser(userId);
    if (!user?.jioConfig?.isConfigured) {
      return { success: false, error: 'Jio RCS not configured' };
    }
    
    const accessToken = await getAccessToken(user.jioConfig, userId);
    const assistantId = user.jioConfig.assistantId;
    
    const payload = buildPayload(templateType, content, variables);
    const url = `https://api.businessmessaging.jio.com/v1/messaging/users/${phoneNumber}/assistantMessages/async?messageId=${messageId}&assistantId=${assistantId}`;
    
    // Send to Jio API - don't wait for response
    axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      timeout: 3000
    }).then(response => {
      if (response.status === 201) {
        const jioMessageId = response.data?.messageId;
        // Fire-and-forget DB update
        ContactCampaignMessage.updateOne(
          { 
            'campaigns.messageId': messageId,
            'campaigns.campaignId': campaignId
          },
          { 
            $set: { 
              'campaigns.$.rcsMessageId': jioMessageId,
              'campaigns.$.jioMessageId': jioMessageId,
              'campaigns.$.status': 'sent',
              'campaigns.$.sentAt': new Date()
            }
          }
        ).catch(() => {});
      }
    }).catch(() => {});
    
    return { success: true };
    
  } catch (error) {
    return { success: false, error: error.message };
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
  // Fire-and-forget
  ContactCampaignMessage.updateOne(
    { 
      'campaigns.messageId': messageId,
      'campaigns.campaignId': campaignId
    },
    { 
      $set: { 
        'campaigns.$.status': 'failed',
        'campaigns.$.errorMessage': error,
        'campaigns.$.failedAt': new Date()
      }
    }
  ).catch(err => console.error('[Sender] Mark failed error:', err.message));
}

// Remove slow campaign completion checks - handle separately
async function checkCampaignCompletion(campaignId) {
  // Disabled for speed - completion checked by separate worker
  return;
}

async function checkMasterCampaignCompletion(masterCampaignId) {
  // Disabled for speed - completion checked by separate worker
  return;
}

startMessageSender();
