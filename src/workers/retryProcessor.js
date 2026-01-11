import mongoose from 'mongoose';
import { Kafka } from 'kafkajs';
import axios from 'axios';
import connectDB from '../db/index.js';
import ContactCampaignMessage from '../models/message.model.js';
import User from '../models/user.model.js';

process.env.WORKER_MODE = 'true';

const RETRY_POLICIES = {
  '429': { maxRetries: Infinity, delayRange: [500, 2000] },
  'timeout': { maxRetries: 100, delayRange: [1000, 3000] },
  'connection': { maxRetries: 3, delayRange: [1000, 2000] }
};

let successAfterRetry = 0;
let finalFailures = 0;

// Token cache
const tokenCache = new Map();
const userCache = new Map();

async function getUser(userId) {
  const cached = userCache.get(userId);
  if (cached && (Date.now() - cached.cachedAt) < 300000) {
    return cached.user;
  }
  const user = await User.findById(userId).select('+jioConfig.clientSecret');
  userCache.set(userId, { user, cachedAt: Date.now() });
  return user;
}

async function getAccessToken(jioConfig, userId) {
  const cached = tokenCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }
  const { clientId, clientSecret } = jioConfig;
  const url = `https://tgs.businessmessaging.jio.com/v1/oauth/token?grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}&scope=read`;
  const response = await axios.get(url, { timeout: 10000 });
  const token = response.data.access_token;
  tokenCache.set(userId, { token, expiresAt: Date.now() + (55 * 60 * 1000) });
  return token;
}

async function startRetryProcessor() {
  try {
    await connectDB();
    console.log('✅ Retry Processor connected to MongoDB');
    
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
    await consumer.subscribe({ topic: 'rcs-retries', fromBeginning: false });
    
    console.log('✅ Retry Processor subscribed to rcs-retries');
    
    await consumer.run({
      partitionsConsumedConcurrently: 5,
      eachBatchAutoResolve: false,
      eachBatch: async ({ batch, resolveOffset, heartbeat }) => {
        for (const message of batch.messages) {
          const retryData = JSON.parse(message.value.toString());
          
          // Wait for retry delay
          const now = Date.now();
          if (retryData.retryAfter > now) {
            await new Promise(resolve => setTimeout(resolve, retryData.retryAfter - now));
          }
          
          try {
            const result = await sendMessage(retryData);
            
            if (result.success) {
              successAfterRetry++;
              console.log(`[Retry] ✅ Success after ${retryData.retryCount} attempts for ${retryData.phoneNumber}`);
              await resolveOffset(message.offset);
            } else {
              const errorType = classifyError(result.statusCode, result.error);
              const policy = RETRY_POLICIES[errorType];
              
              if (policy && retryData.retryCount < policy.maxRetries) {
                // Re-queue for another retry
                const delay = Math.random() * (policy.delayRange[1] - policy.delayRange[0]) + policy.delayRange[0];
                
                await retryProducer.send({
                  topic: 'rcs-retries',
                  messages: [{
                    key: retryData.messageId,
                    value: JSON.stringify({
                      ...retryData,
                      retryCount: retryData.retryCount + 1,
                      errorType,
                      retryAfter: Date.now() + delay
                    })
                  }]
                });
                
                console.log(`[Retry] Re-queued ${retryData.phoneNumber} (${errorType}, attempt ${retryData.retryCount + 1})`);
              } else {
                // Final failure
                finalFailures++;
                await markMessageFailed(retryData.messageId, `Max retries (${retryData.retryCount}) reached: ${result.error}`, retryData.campaignId);
                console.log(`[Retry] ❌ Final failure for ${retryData.phoneNumber} after ${retryData.retryCount} attempts`);
              }
              
              await resolveOffset(message.offset);
            }
          } catch (error) {
            console.error('[Retry] Error:', error.message);
            await resolveOffset(message.offset);
          }
          
          await heartbeat();
        }
        
        if (successAfterRetry % 50 === 0 && successAfterRetry > 0) {
          console.log(`[Retry] Success: ${successAfterRetry}, Final Failures: ${finalFailures}`);
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
    const user = await getUser(userId);
    if (!user?.jioConfig?.isConfigured) {
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
    
    if (result.length > 0 && result[0].pending === 0 && result[0].total > 0) {
      console.log(`[Retry] ✅ Campaign ${campaignId} completed (${result[0].total} messages)`);
      await Campaign.updateOne(
        { _id: campaignId, status: 'running' },
        { status: 'completed', completedAt: new Date() }
      );
    }
  } catch (error) {
    console.error('[Retry] Campaign completion check error:', error.message);
  }
}

startRetryProcessor();
