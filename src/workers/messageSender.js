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
      maxInFlightRequests: 5
    });
    
    await consumer.connect();
    await retryProducer.connect();
    await consumer.subscribe({ topic: 'rcs-messages', fromBeginning: true });
    
    console.log('✅ Message Sender subscribed to rcs-messages');
    
    await consumer.run({
      partitionsConsumedConcurrently: 10,
      eachBatchAutoResolve: false,
      eachBatch: async ({ batch, resolveOffset, heartbeat }) => {
        for (const message of batch.messages) {
          const messageData = JSON.parse(message.value.toString());
          
          try {
            const result = await sendMessage(messageData);
            
            if (result.success) {
              totalSent++;
              await resolveOffset(message.offset);
            } else {
              // Check if should retry
              const errorType = classifyError(result.statusCode, result.error);
              const policy = RETRY_POLICIES[errorType];
              
              if (policy && messageData.retryCount < policy.maxRetries) {
                // Send to retry topic
                const delay = Math.random() * (policy.delayRange[1] - policy.delayRange[0]) + policy.delayRange[0];
                
                await retryProducer.send({
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
                });
                
                totalRetries++;
                if (errorType === '429') total429++;
                if (errorType === 'timeout') totalTimeout++;
                
                console.log(`[Sender] Retry queued for ${messageData.phoneNumber} (${errorType}, attempt ${messageData.retryCount + 1})`);
              } else {
                // Final failure
                totalFailed++;
                await markMessageFailed(messageData.messageId, result.error, messageData.campaignId);
              }
              
              await resolveOffset(message.offset);
            }
          } catch (error) {
            console.error('[Sender] Error:', error.message);
            await resolveOffset(message.offset);
          }
          
          await heartbeat();
        }
        
        // Log stats every 100 messages
        if (totalSent % 100 === 0 && totalSent > 0) {
          console.log(`[Sender] Sent: ${totalSent}, Failed: ${totalFailed}, 429: ${total429}, Timeout: ${totalTimeout}, Retries: ${totalRetries}`);
        }
      }
    });
    
  } catch (error) {
    console.error('❌ Message sender startup failed:', error);
    process.exit(1);
  }
}

async function sendMessage(messageData) {
  const { phoneNumber, messageId, userId, templateType, content, variables } = messageData;
  
  console.log(`[Sender] Processing message: messageId=${messageId}, phone=${phoneNumber}`);
  
  try {
    const user = await getUser(userId);
    if (!user?.jioConfig?.isConfigured) {
      console.error(`[Sender] User ${userId} Jio not configured`);
      return { success: false, error: 'Jio RCS not configured' };
    }
    
    const accessToken = await getAccessToken(user.jioConfig, userId);
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
      console.log(`[Sender] ✅ Message sent successfully: messageId=${messageId}`);
      await ContactCampaignMessage.updateOne(
        { 
          'campaigns.messageId': messageId,
          'campaigns.campaignId': messageData.campaignId
        },
        { 
          $set: { 
            'campaigns.$.rcsMessageId': response.data?.messageId,
            'campaigns.$.status': 'sent',
            'campaigns.$.sentAt': new Date()
          }
        }
      );
      
      // Check if campaign is complete
      await checkCampaignCompletion(messageData.campaignId);
      
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
  await ContactCampaignMessage.updateOne(
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
  );
  
  // Check if campaign is complete
  await checkCampaignCompletion(campaignId);
}

async function checkCampaignCompletion(campaignId) {
  try {
    const Campaign = (await import('../models/campaign.model.js')).default;
    
    // Use aggregation to check and update in one query (faster)
    const result = await ContactCampaignMessage.aggregate([
      { $match: { 'campaigns.campaignId': campaignId } },
      { $unwind: '$campaigns' },
      { $match: { 'campaigns.campaignId': campaignId } },
      {
        $group: {
          _id: null,
          pending: {
            $sum: {
              $cond: [
                { $in: ['$campaigns.status', ['draft', 'queued', 'processing']] },
                1,
                0
              ]
            }
          },
          total: { $sum: 1 }
        }
      }
    ]);
    
    // Complete if: (1) no pending messages AND has messages, OR (2) no messages at all
    const hasPending = result.length > 0 && result[0].pending > 0;
    const hasMessages = result.length > 0 && result[0].total > 0;
    
    if (!hasPending) {
      const totalMessages = hasMessages ? result[0].total : 0;
      console.log(`[Sender] ✅ Campaign ${campaignId} completed (${totalMessages} messages)`);
      
      const campaign = await Campaign.findOneAndUpdate(
        { _id: campaignId, status: 'running' },
        { status: 'completed', completedAt: new Date() },
        { new: true }
      );
      
      // If this is a sub-campaign, check if master campaign should be completed
      if (campaign && campaign.masterCampaignId) {
        await checkMasterCampaignCompletion(campaign.masterCampaignId);
      }
    }
  } catch (error) {
    console.error('[Sender] Campaign completion check error:', error.message);
  }
}

async function checkMasterCampaignCompletion(masterCampaignId) {
  try {
    const Campaign = (await import('../models/campaign.model.js')).default;
    
    // Check if all sub-campaigns are completed
    const pendingSubCampaigns = await Campaign.countDocuments({
      masterCampaignId,
      status: { $nin: ['completed', 'failed'] }
    });
    
    if (pendingSubCampaigns === 0) {
      console.log(`[Sender] ✅ Master campaign ${masterCampaignId} completed (all sub-campaigns done)`);
      await Campaign.updateOne(
        { _id: masterCampaignId, status: 'running' },
        { status: 'completed', completedAt: new Date() }
      );
    }
  } catch (error) {
    console.error('[Sender] Master campaign completion check error:', error.message);
  }
}

startMessageSender();
