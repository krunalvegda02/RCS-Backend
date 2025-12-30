
// import axios from 'axios';
// import Bull from 'bull';
// import redis from 'redis';
// import Message from '../models/message.model.js';
// import { APIResult } from '../models/APIReport.model.js';
// import Campaign from '../models/campaign.model.js';
// import User from '../models/user.model.js';

// const JIOAPI_BASE_URL = process.env.JIO_API_BASE_URL || 'https://api.businessmessaging.jio.com';
// const JIO_SECRET_KEY = process.env.JIO_SECRET_KEY;
// const JIO_SECRET_ID = process.env.JIO_SECRET_ID;

// // Validate required environment variables
// if (!JIO_SECRET_KEY || !JIO_SECRET_ID) {
//   throw new Error('Missing required Jio API credentials: JIO_SECRET_KEY and JIO_SECRET_ID must be set');
// }

// // Redis client for caching capability tokens
// let redisClient = null;

// try {
//   redisClient = redis.createClient({
//     url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`,
//   });

//   // Connect Redis client
//   redisClient.on('error', (err) => {
//     console.error('Redis Client Error:', err);
//     redisClient = null;
//   });

//   redisClient.on('connect', () => {
//     console.log('Redis Client Connected');
//   });

//   redisClient.on('ready', () => {
//     console.log('Redis Client Ready');
//   });

//   redisClient.on('end', () => {
//     console.log('Redis Client Disconnected');
//   });

//   // Connect to Redis
//   if (!redisClient.isOpen) {
//     redisClient.connect().catch(() => {
//       console.log('Redis not available, running without cache');
//       redisClient = null;
//     });
//   }
// } catch (error) {
//   console.log('Redis not available, running without cache');
//   redisClient = null;
// }

// class JioRCSService {
//   constructor() {
//     this.messageQueue = new Bull('jio-rcs-messages', {
//       redis: { 
//         host: process.env.REDIS_HOST, 
//         port: process.env.REDIS_PORT 
//       },
//       defaultJobOptions: {
//         attempts: 3,
//         backoff: {
//           type: 'exponential',
//           delay: 2000,
//         },
//         removeOnComplete: true,
//       },
//     });

//     this.setupQueueHandlers();
//   }

//   // ====== TOKEN MANAGEMENT ======
//   /**
//    * Get OAuth access token from Jio API using user's credentials
//    */
//   async getAccessToken(userId) {
//     try {
//       // Get user's Jio credentials
//       const user = await User.findById(userId).select('+jioConfig.clientSecret');
//       if (!user || !user.jioConfig?.isConfigured) {
//         throw new Error('Jio RCS not configured for this user');
//       }
      
//       const { clientId, clientSecret } = user.jioConfig;
//       const tokenUrl = `https://tgs.businessmessaging.jio.com/v1/oauth/token?grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}&scope=read`;
      
//       const response = await axios.get(tokenUrl, {
//         timeout: 10000,
//       });
      
//       console.log('[RCS] Access token obtained successfully');
//       return response.data.access_token;
//     } catch (error) {
//       console.error('[RCS] Failed to get access token:', error.message);
//       throw new Error('Failed to authenticate with Jio API');
//     }
//   }

//   // ====== CAPABILITY CHECK & TOKEN GENERATION ======
//   /**
//    * Check if a phone number supports RCS and get capability token
//    * Critical: This must be called BEFORE sending any message
//    */
//   async checkCapabilityAndGetToken(phoneNumber, userId) {
//     try {
//       // Get user's Jio config
//       const user = await User.findById(userId).select('+jioConfig.clientSecret');
//       if (!user || !user.jioConfig?.isConfigured) {
//         throw new Error('Jio RCS not configured for this user');
//       }
      
//       const assistantId = user.jioConfig.assistantId || 'default_assistant';
      
//       // Format phone number (ensure it starts with +91)
//       const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+91${phoneNumber}`;
      
//       // Check Redis cache first
//       const cacheKey = `rcs_capability:${formattedPhone}:${assistantId}`;
//       const cachedToken = await this.getCachedToken(cacheKey);

//       if (cachedToken && !this.isTokenExpired(cachedToken.expiresAt)) {
//         console.log(`[RCS] Using cached token for ${formattedPhone}`);
//         return cachedToken;
//       }

//       // Get OAuth access token
//       const accessToken = await this.getAccessToken(userId);

//       // Call Jio API to check capability
//       const response = await axios.get(
//         `${JIOAPI_BASE_URL}/v1/messaging/users/${formattedPhone}/capabilities`,
//         {
//           headers: {
//             'Authorization': `Bearer ${accessToken}`,
//             'Content-Type': 'application/json',
//           },
//           timeout: 10000,
//         }
//       );

//       console.log("[RCS] Capability check response:", response.data);
//       // Parse response - Jio API returns features array, not capability token
//       const tokenData = {
//         token: response.data.capabilityToken || null, // No token in response
//         isCapable: response.data.features && response.data.features.length > 0,
//         expiresAt: new Date(Date.now() + 86400000), // 24 hours
//         phoneNumber: formattedPhone,
//         features: response.data.features || [],
//       };

//       // Save to cache
//       await this.cacheToken(cacheKey, tokenData);

//       // Save result
//       await APIResult.create({
//         messageId: `capability_check_${formattedPhone}`,
//         userId: userId,
//         statusCode: response.status,
//         status: tokenData.isCapable ? 'success' : 'unsupported',
//         capabilityStatus: tokenData.isCapable ? 'rcs_capable' : 'not_capable',
//         capabilityToken: tokenData.token,
//         responseBody: response.data,
//         responseTimeMs: response.headers['x-response-time'],
//         requestTime: new Date(),
//         responseTime: new Date(),
//       });

//       return tokenData;
//     } catch (error) {
//       console.error(`[RCS] Capability check failed for ${phoneNumber}:`, error.message);
//       if (error.response) {
//         console.error(`[RCS] Response status: ${error.response.status}`);
//         console.error(`[RCS] Response data:`, error.response.data);
//       }

//       // Log failed attempt
//       await APIResult.create({
//         messageId: `capability_check_${phoneNumber}`,
//         userId: userId,
//         statusCode: error.response?.status || 500,
//         status: 'failed',
//         capabilityStatus: 'unknown',
//         errorCode: error.response?.data?.errorCode || 'CAPABILITY_CHECK_FAILED',
//         errorMessage: error.message,
//         errorType: this.getErrorType(error),
//         responseBody: error.response?.data,
//         requestTime: new Date(),
//         responseTime: new Date(),
//       });

//       throw error;
//     }
//   }

//   // ====== MESSAGE SENDING ======
//   /**
//    * Send RCS message - handles all 4 message types
//    * @param {Object} messageData - Contains recipient, template, content, etc.
//    */
//   async sendMessage(messageData) {
//     const {
//       phoneNumber,
//       messageId,
//       userId,
//       campaignId,
//       templateId,
//       templateType,
//       content,
//       capabilityToken,
//       variables,
//     } = messageData;

//     // Get user's Jio config
//     const user = await User.findById(userId).select('+jioConfig.clientSecret');
//     if (!user || !user.jioConfig?.isConfigured) {
//       throw new Error('Jio RCS not configured for this user');
//     }
    
//     const assistantId = user.jioConfig.assistantId || 'default_assistant';

//     // Format phone number
//     const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+91${phoneNumber}`;

//     // Query message once at the beginning
//     const message = await Message.findOne({ messageId });

//     // Build RCS message payload based on type (declare outside try block)
//     let rcsPayload;

//     try {
//       // Get OAuth access token
//       const accessToken = await this.getAccessToken(userId);

//       // Build RCS message payload based on type
//       rcsPayload = this.buildRCSPayload(
//         templateType,
//         content,
//         variables,
//         capabilityToken
//       );

//       console.log(`[RCS] Sending message payload:`, JSON.stringify(rcsPayload, null, 2));

//       // Call Jio API
//       const response = await axios.post(
//         `${JIOAPI_BASE_URL}/v1/messaging/users/${formattedPhone}/assistantMessages/async?messageId=${messageId}&assistantId=${assistantId}`,
//         rcsPayload,
//         {
//           headers: {
//             'Authorization': `Bearer ${accessToken}`,
//             'Content-Type': 'application/json',
//           },
//           timeout: 15000,
//         }
//       );

//       // Mark message as sent
//       if (message) {
//         await message.markAsSent(response.data.messageId || messageId);
//       }

//       console.log(`[RCS] ✅ Message API Response:`, JSON.stringify(response.data, null, 2));
//       console.log(`[RCS] 📊 Response Status: ${response.status}`);
//       console.log(`[RCS] 🆔 RCS Message ID: ${response.data.messageId}`);
      
//       // Get ngrok URL from environment or show instructions
//       const ngrokUrl = process.env.NGROK_URL || 'YOUR_NGROK_URL_HERE';
//       console.log(`\n🚨 WEBHOOK SETUP REQUIRED:`);
//       console.log(`1. Copy this URL: ${ngrokUrl}/api/v1/webhooks/jio/rcs/webhook`);
//       console.log(`2. Configure it in Jio RCS Dashboard under Webhook Settings`);
//       console.log(`3. Check ngrok inspector: http://127.0.0.1:4040/inspect/http`);
//       console.log(`4. Verify RCS is enabled on device: ${formattedPhone}\n`);


//       // Save API result
//       await APIResult.create({
//         messageId,
//         userId,
//         campaignId,
//         statusCode: response.status,
//         status: 'success',
//         responseBody: response.data,
//         rcsMessageId: response.data.messageId,
//         requestTime: new Date(),
//         responseTime: new Date(),
//         responseTimeMs: response.headers['x-response-time'],
//         capabilityToken: capabilityToken,
//       });

//       return { success: true, rcsMessageId: response.data.messageId };
//     } catch (error) {
//       console.error(`[RCS] Message send failed for ${phoneNumber}:`, error.message);
//       if (error.response) {
//         console.error(`[RCS] Send response status: ${error.response.status}`);
//         console.error(`[RCS] Send response data:`, error.response.data);
//         console.error(`[RCS] Send request payload:`, JSON.stringify(rcsPayload, null, 2));
//       }

//       // Handle specific errors
//       const errorType = this.getErrorType(error);
//       const errorCode = error.response?.data?.errorCode || error.code;

//       // Determine if retry needed
//       const shouldRetry = ['rate_limit', 'network', 'service'].includes(errorType);

//       // Save API result
//       await APIResult.create({
//         messageId,
//         userId,
//         campaignId,
//         statusCode: error.response?.status || 500,
//         status: shouldRetry ? 'retry' : 'failed',
//         errorCode,
//         errorMessage: error.message,
//         errorType,
//         responseBody: error.response?.data,
//         requestTime: new Date(),
//         responseTime: new Date(),
//         isRetry: false,
//       });

//       // Update message status
//       if (message) {
//         if (shouldRetry) {
//           await message.scheduleRetry();
//         } else {
//           await message.markAsFailed(errorCode, error.message);
//         }
//       }

//       throw error;
//     }
//   }

//   // ====== PAYLOAD BUILDERS (4 MESSAGE TYPES) ======
//   buildRCSPayload(templateType, content, variables, capabilityToken) {
//     switch (templateType) {
//       case 'richCard':
//         return {
//           content: {
//             richCard: {
//               cardOrientation: 'VERTICAL',
//               cardHeight: 'MEDIUM',
//               contents: [{
//                 title: this.replaceVariables(content.title, variables),
//                 description: this.replaceVariables(content.description, variables),
//                 media: {
//                   height: 'MEDIUM',
//                   contentUrl: content.imageUrl,
//                 },
//                 suggestions: content.actions?.map(action => ({
//                   action: {
//                     text: action.label,
//                     postbackData: action.uri,
//                     uri: action.uri,
//                   },
//                   reply: {
//                     displayText: action.label,
//                     postbackData: action.uri,
//                   },
//                 })) || [],
//               }],
//             },
//           },
//           capabilityToken,
//         };

//       case 'carousel':
//         return {
//           content: {
//             richCard: {
//               cardOrientation: 'HORIZONTAL',
//               cardHeight: 'MEDIUM',
//               contents: content.cards?.map(card => ({
//                 title: this.replaceVariables(card.title, variables),
//                 description: this.replaceVariables(card.description, variables),
//                 media: {
//                   height: 'MEDIUM',
//                   contentUrl: card.imageUrl,
//                 },
//                 suggestions: card.actions?.map(action => ({
//                   action: {
//                     text: action.label,
//                     postbackData: action.uri,
//                     uri: action.uri,
//                   },
//                 })) || [],
//               })) || [],
//             },
//           },
//           capabilityToken,
//         };

//       case 'textWithAction':
//         return {
//           content: {
//             plainText: this.replaceVariables(content.text, variables),
//             suggestions: content.buttons?.map(btn => ({
//               reply: {
//                 plainText: btn.label,
//                 postBack: {
//                   data: btn.value,
//                 },
//               },
//               action: {
//                 openUrl: {
//                   url: btn.value.startsWith('http') ? btn.value : `https://example.com?action=${btn.value}`,
//                 },
//               },
//             })) || [],
//           },
//           capabilityToken,
//         };

//       case 'plainText':
//         return {
//           content: {
//             plainText: this.replaceVariables(content.body, variables),
//           },
//           // Don't include capabilityToken if it's null
//           ...(capabilityToken && { capabilityToken }),
//         };

//       default:
//         throw new Error(`Unknown message type: ${templateType}`);
//     }
//   }

//   // ====== HELPER METHODS ======
//   replaceVariables(text, variables = {}) {
//     if (!text) return '';
//     let result = text;
//     Object.entries(variables).forEach(([key, value]) => {
//       result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
//     });
//     return result;
//   }

//   generateUUID() {
//     return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
//   }

//   getErrorType(error) {
//     if (!error.response) return 'network';
//     const status = error.response.status;
//     if (status === 429) return 'rate_limit';
//     if (status >= 400 && status < 500) return 'validation';
//     if (status >= 500) return 'service';
//     return 'unknown';
//   }

//   async getCachedToken(key) {
//     if (!redisClient) return null;
//     try {
//       if (!redisClient.isOpen) {
//         await redisClient.connect();
//       }
//       const data = await redisClient.get(key);
//       return data ? JSON.parse(data) : null;
//     } catch (error) {
//       console.error('Redis get error:', error);
//       return null;
//     }
//   }

//   async cacheToken(key, tokenData) {
//     if (!redisClient) return;
//     try {
//       if (!redisClient.isOpen) {
//         await redisClient.connect();
//       }
//       await redisClient.setEx(key, 86400, JSON.stringify(tokenData));
//     } catch (error) {
//       console.error('Redis set error:', error);
//     }
//   }

//   isTokenExpired(expiresAt) {
//     return new Date(expiresAt) < new Date();
//   }

//   // ====== QUEUE HANDLERS ======
//   setupQueueHandlers() {
//     this.messageQueue.process(1000, async (job) => {
//       const { messageData } = job.data;
//       try {
//         await this.sendMessage(messageData);
//         return { success: true };
//       } catch (error) {
//         if (job.attemptsMade < job.opts.attempts) {
//           throw error; // Let Bull retry
//         }
//         // Final failure
//         return { success: false, error: error.message };
//       }
//     });

//     this.messageQueue.on('completed', (job) => {
//       console.log(`[Queue] Message ${job.data.messageData.messageId} sent successfully`);
//     });

//     this.messageQueue.on('failed', (job, err) => {
//       console.error(`[Queue] Message ${job.data.messageData.messageId} failed:`, err.message);
//     });
//   }

//   // ====== BATCH CAPABILITY CHECK ======
//   /**
//    * Check RCS capability for multiple phone numbers at once
//    * Returns array with capability status for each number
//    */
//   async checkBatchCapability(phoneNumbers, userId) {
//     const results = [];
    
//     console.log(`[RCS] Checking capability for ${phoneNumbers.length} numbers`);
    
//     for (const phoneNumber of phoneNumbers) {
//       try {
//         const capabilityData = await this.checkCapabilityAndGetToken(
//           phoneNumber,
//           userId
//         );
        
//         results.push({
//           phoneNumber,
//           isCapable: capabilityData.isCapable,
//           token: capabilityData.token,
//           expiresAt: capabilityData.expiresAt,
//           status: 'checked'
//         });
        
//         // Rate limiting between checks
//         await this.sleep(500);
//       } catch (error) {
//         console.error(`[RCS] Capability check failed for ${phoneNumber}:`, error.message);
//         results.push({
//           phoneNumber,
//           isCapable: false,
//           token: null,
//           error: error.message,
//           status: 'error'
//         });
//       }
//     }
    
//     return results;
//   }
//   /**
//    * Process campaign messages in optimized batches
//    * Only processes and charges for RCS capable numbers
//    */
//   async processCampaignBatch(campaignId, batchSize = 100, delayMs = 1000) {
//     try {
//       const campaign = await Campaign.findById(campaignId).populate('templateId');
//       if (!campaign) throw new Error('Campaign not found');

//       // Get pending recipients (all types)
//       const pendingRecipients = campaign.getPendingRecipients(batchSize);
      
//       if (pendingRecipients.length === 0) {
//         console.log(`[RCS] No pending recipients for campaign ${campaignId}`);
//         return;
//       }

//       console.log(`[RCS] Processing ${pendingRecipients.length} recipients for campaign ${campaignId}`);

//       for (const recipient of pendingRecipients) {
//         try {
//           // Mark as processing
//           await campaign.markRecipientAsProcessing(recipient.phoneNumber);

//           // If recipient is already marked as non-RCS capable, skip capability check
//           if (recipient.isRcsCapable === false) {
//             await campaign.markRecipientAsFailed(
//               recipient.phoneNumber,
//               'Device not RCS capable (pre-checked)'
//             );
//             console.log(`[RCS] Skipping non-RCS capable number: ${recipient.phoneNumber}`);
//             continue;
//           }

//           // Check capability for this recipient (if not already checked)
//           let capabilityData;
//           if (recipient.isRcsCapable === true) {
//             // Already verified as RCS capable, get cached token
//             const cacheKey = `rcs_capability:${recipient.phoneNumber}:${process.env.JIO_ASSISTANT_ID || 'default_assistant'}`;
//             capabilityData = await this.getCachedToken(cacheKey);
            
//             if (!capabilityData || this.isTokenExpired(capabilityData.expiresAt)) {
//               // Re-check capability if token expired
//               capabilityData = await this.checkCapabilityAndGetToken(
//                 recipient.phoneNumber,
//                 campaign.userId
//               );
//             }
//           } else {
//             // First time capability check
//             capabilityData = await this.checkCapabilityAndGetToken(
//               recipient.phoneNumber,
//               campaign.userId
//             );
//           }

//           if (!capabilityData.isCapable) {
//             await campaign.markRecipientAsFailed(
//               recipient.phoneNumber,
//               'Device not RCS capable'
//             );
//             console.log(`[RCS] Non-RCS capable number: ${recipient.phoneNumber} - NO CHARGE`);
//             continue;
//           }

//           // Only create message and charge for RCS capable numbers
//           const messageId = this.generateUUID();
//           const message = await Message.create({
//             messageId,
//             campaignId,
//             userId: campaign.userId,
//             recipientPhoneNumber: recipient.phoneNumber,
//             templateId: campaign.templateId._id,
//             templateType: campaign.templateId.templateType,
//             content: campaign.templateId.content,
//             variables: recipient.variables,
//             jioCapabilityToken: capabilityData.token,
//             assistantId: process.env.JIO_ASSISTANT_ID || 'default_assistant',
//             status: 'queued',
//             queuedAt: new Date(),
//             cost: 1, // ₹1 per RCS message
//           });

//           // Add to queue for processing
//           await this.messageQueue.add(
//             {
//               messageData: {
//                 phoneNumber: recipient.phoneNumber,
//                 messageId,
//                 userId: campaign.userId,
//                 campaignId,
//                 templateId: campaign.templateId._id,
//                 templateType: campaign.templateId.templateType,
//                 content: campaign.templateId.content,
//                 assistantId: process.env.JIO_ASSISTANT_ID || 'default_assistant',
//                 capabilityToken: capabilityData.token,
//                 variables: recipient.variables,
//               },
//             },
//             {
//               priority: 10,
//               delay: Math.random() * 2000, // Random jitter
//             }
//           );

//           console.log(`[RCS] Queued RCS capable number: ${recipient.phoneNumber} - CHARGED ₹1`);

//           // Respect rate limits
//           await this.sleep(delayMs);
//         } catch (error) {
//           console.error(`Error processing recipient ${recipient.phoneNumber}:`, error.message);
//           await campaign.markRecipientAsFailed(recipient.phoneNumber, error.message);
//         }
//       }

//       // Update campaign stats
//       await campaign.updateStats();
      
//       // Check if there are more recipients to process
//       const remainingRecipients = campaign.getPendingRecipients(1);
//       if (remainingRecipients.length > 0) {
//         // Schedule next batch
//         setTimeout(() => {
//           this.processCampaignBatch(campaignId, batchSize, delayMs);
//         }, 5000); // 5 second delay between batches
//       } else {
//         // Mark campaign as completed
//         campaign.status = 'completed';
//         campaign.completedAt = new Date();
//         await campaign.save();
//         console.log(`[RCS] Campaign ${campaignId} completed`);
//       }
//     } catch (error) {
//       console.error(`[RCS] Error processing campaign batch ${campaignId}:`, error.message);
//     }
//   }

//   sleep(ms) {
//     return new Promise(resolve => setTimeout(resolve, ms));
//   }

//   // Cleanup method for graceful shutdown
//   async cleanup() {
//     try {
//       if (redisClient && redisClient.isOpen) {
//         await redisClient.quit();
//         console.log('Redis client disconnected');
//       }
//       await this.messageQueue.close();
//       console.log('Message queue closed');
//     } catch (error) {
//       console.error('Error during cleanup:', error);
//     }
//   }
// }

// export default new JioRCSService();













import axios from 'axios';
import Bull from 'bull';
import redis from 'redis';

import Message from '../models/message.model.js';
import { APIResult } from '../models/APIReport.model.js';
import Campaign from '../models/campaign.model.js';
import User from '../models/user.model.js';

const JIOAPI_BASE_URL =
  process.env.JIO_API_BASE_URL || 'https://api.businessmessaging.jio.com';

// (Optional) if your app expects these to exist
const JIO_SECRET_KEY = process.env.JIO_SECRET_KEY;
const JIO_SECRET_ID = process.env.JIO_SECRET_ID;

// Validate required environment variables (keep if your project requires)
if (!JIO_SECRET_KEY || !JIO_SECRET_ID) {
  console.warn(
    '[RCS] Warning: JIO_SECRET_KEY / JIO_SECRET_ID not set. If your app requires them, configure env vars.'
  );
}

// ===================== Redis client (optional cache) =====================
let redisClient = null;

try {
  redisClient = redis.createClient({
    url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`,
  });

  redisClient.on('error', (err) => {
    console.error('[RCS] Redis Client Error:', err);
    redisClient = null;
  });

  redisClient.on('connect', () => console.log('[RCS] Redis Client Connected'));
  redisClient.on('ready', () => console.log('[RCS] Redis Client Ready'));
  redisClient.on('end', () => console.log('[RCS] Redis Client Disconnected'));

  if (!redisClient.isOpen) {
    redisClient.connect().catch(() => {
      console.log('[RCS] Redis not available, running without cache');
      redisClient = null;
    });
  }
} catch (e) {
  console.log('[RCS] Redis not available, running without cache');
  redisClient = null;
}

class JioRCSService {
  constructor() {
    this.messageQueue = new Bull('jio-rcs-messages', {
      redis: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT,
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
      },
    });

    this.setupQueueHandlers();
  }

  // ===================== TOKEN MANAGEMENT =====================
  /**
   * Get OAuth access token from Jio using user's configured credentials.
   */
  async getAccessToken(userId) {
    try {
      const user = await User.findById(userId).select('+jioConfig.clientSecret');
      if (!user || !user.jioConfig?.isConfigured) {
        throw new Error('Jio RCS not configured for this user');
      }

      const { clientId, clientSecret } = user.jioConfig;

      const tokenUrl =
        `https://tgs.businessmessaging.jio.com/v1/oauth/token` +
        `?grant_type=client_credentials` +
        `&client_id=${encodeURIComponent(clientId)}` +
        `&client_secret=${encodeURIComponent(clientSecret)}` +
        `&scope=read`;

      const response = await axios.get(tokenUrl, { timeout: 10000 });

      if (!response?.data?.access_token) {
        throw new Error('Invalid token response from Jio');
      }

      return response.data.access_token;
    } catch (error) {
      console.error('[RCS] Failed to get access token:', error.message);
      throw new Error('Failed to authenticate with Jio API');
    }
  }

  // ===================== CAPABILITY CHECK + CACHE =====================
  /**
   * Checks if a number is RCS capable. Caches result in Redis (24h).
   */
  async checkCapabilityAndGetToken(phoneNumber, userId) {
    const requestTime = new Date();

    try {
      const user = await User.findById(userId).select('+jioConfig.clientSecret');
      if (!user || !user.jioConfig?.isConfigured) {
        throw new Error('Jio RCS not configured for this user');
      }

      const assistantId = user.jioConfig.assistantId || process.env.JIO_ASSISTANT_ID || 'default_assistant';
      const formattedPhone = this.formatPhone(phoneNumber);

      const cacheKey = `rcs_capability:${formattedPhone}:${assistantId}`;
      const cached = await this.getCachedToken(cacheKey);
      if (cached && !this.isTokenExpired(cached.expiresAt)) {
        return cached;
      }

      const accessToken = await this.getAccessToken(userId);

      const response = await axios.get(
        `${JIOAPI_BASE_URL}/v1/messaging/users/${formattedPhone}/capabilities`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );

      // NOTE: Many Jio capability responses return "features" list (not capabilityToken)
      const tokenData = {
        token: response.data?.capabilityToken || null,
        isCapable: Array.isArray(response.data?.features) && response.data.features.length > 0,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
        phoneNumber: formattedPhone,
        features: response.data?.features || [],
      };

      await this.cacheToken(cacheKey, tokenData);

      // optional audit log
      await APIResult.create({
        messageId: `capability_check_${formattedPhone}`,
        userId,
        statusCode: response.status,
        status: tokenData.isCapable ? 'success' : 'unsupported',
        capabilityStatus: tokenData.isCapable ? 'rcs_capable' : 'not_capable',
        capabilityToken: tokenData.token,
        responseBody: response.data,
        requestTime,
        responseTime: new Date(),
      });

      return tokenData;
    } catch (error) {
      console.error(`[RCS] Capability check failed for ${phoneNumber}:`, error.message);

      await APIResult.create({
        messageId: `capability_check_${phoneNumber}`,
        userId,
        statusCode: error.response?.status || 500,
        status: 'failed',
        capabilityStatus: 'unknown',
        errorCode: error.response?.data?.errorCode || 'CAPABILITY_CHECK_FAILED',
        errorMessage: error.message,
        errorType: this.getErrorType(error),
        responseBody: error.response?.data,
        requestTime,
        responseTime: new Date(),
      });

      throw error;
    }
  }

  // ===================== SEND MESSAGE (ALL TYPES) =====================
  /**
   * Send a single RCS message (all 4 types).
   *
   * Expected messageData:
   * {
   *   phoneNumber, messageId, userId, campaignId,
   *   templateType: 'plainText'|'textWithAction'|'richCard'|'carousel',
   *   content: {...},
   *   variables: {...}
   * }
   */
  async sendMessage(messageData) {
    const requestTime = new Date();

    const {
      phoneNumber,
      messageId,
      userId,
      campaignId,
      templateType,
      content,
      variables,
      capabilityToken, // optional - if you already have it
    } = messageData;

    const message = await Message.findOne({ messageId });

    let rcsPayload = null;

    try {
      const user = await User.findById(userId).select('+jioConfig.clientSecret');
      if (!user || !user.jioConfig?.isConfigured) {
        throw new Error('Jio RCS not configured for this user');
      }

      const assistantId = user.jioConfig.assistantId || process.env.JIO_ASSISTANT_ID || 'default_assistant';
      const formattedPhone = this.formatPhone(phoneNumber);

      // if token not supplied, fetch capability
      let finalCapabilityToken = capabilityToken;
      if (!finalCapabilityToken) {
        const cap = await this.checkCapabilityAndGetToken(formattedPhone, userId);
        if (!cap.isCapable) throw new Error('Phone number does not support RCS');
        finalCapabilityToken = cap.token || null;
      }

      const accessToken = await this.getAccessToken(userId);

      // Build Jio-compatible payload (IMPORTANT)
      rcsPayload = this.buildRCSPayload(templateType, content, variables, finalCapabilityToken);

      const url =
        `${JIOAPI_BASE_URL}/v1/messaging/users/${formattedPhone}/assistantMessages/async` +
        `?messageId=${encodeURIComponent(messageId)}` +
        `&assistantId=${encodeURIComponent(assistantId)}`;

      const response = await axios.post(url, rcsPayload, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      });

      if (message) {
        // keep your existing schema methods
        await message.markAsSent(response.data?.messageId || messageId);
      }

      await APIResult.create({
        messageId,
        userId,
        campaignId,
        statusCode: response.status,
        status: 'success',
        responseBody: response.data,
        rcsMessageId: response.data?.messageId,
        capabilityToken: finalCapabilityToken,
        requestTime,
        responseTime: new Date(),
      });

      return { success: true, rcsMessageId: response.data?.messageId };
    } catch (error) {
      console.error(`[RCS] Message send failed for ${phoneNumber}:`, error.message);

      if (error.response) {
        console.error('[RCS] Status:', error.response.status);
        console.error('[RCS] Data:', error.response.data);
        console.error('[RCS] Payload:', JSON.stringify(rcsPayload, null, 2));
      }

      const errorType = this.getErrorType(error);
      const errorCode = error.response?.data?.errorCode || error.code || 'SEND_FAILED';
      const shouldRetry = ['rate_limit', 'network', 'service'].includes(errorType);

      await APIResult.create({
        messageId,
        userId,
        campaignId,
        statusCode: error.response?.status || 500,
        status: shouldRetry ? 'retry' : 'failed',
        errorCode,
        errorMessage: error.message,
        errorType,
        responseBody: error.response?.data,
        requestTime,
        responseTime: new Date(),
        isRetry: false,
      });

      if (message) {
        if (shouldRetry) await message.scheduleRetry();
        else await message.markAsFailed(errorCode, error.message);
      }

      throw error;
    }
  }

  // ===================== PAYLOAD BUILDERS (JIO-COMPATIBLE) =====================
  /**
   * IMPORTANT: Build proper Jio API payload structure for all message types.
   */
  buildRCSPayload(templateType, content, variables = {}, capabilityToken) {
    let jioContent;
    
    switch (templateType) {
 case 'richCard': {
  console.log('[RCS] 🔍 Building rich card payload');
  console.log('[RCS] Raw content received:', JSON.stringify(content, null, 2));
  
  // Extract and process fields with STRICT validation
  const title = this.replaceVariables(content?.title, variables);
  const description = this.replaceVariables(
    content?.description || content?.subtitle, 
    variables
  );
  const imageUrl = content?.imageUrl;

  // CRITICAL: Validate that fields have ACTUAL content (not just whitespace)
  const hasValidTitle = title && typeof title === 'string' && title.trim().length > 0;
  const hasValidDescription = description && typeof description === 'string' && description.trim().length > 0;
  const hasValidImage = imageUrl && typeof imageUrl === 'string' && imageUrl.trim().length > 0 && 
                        (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'));

  console.log('[RCS] ✅ Field validation:', { 
    hasValidTitle, 
    hasValidDescription, 
    hasValidImage,
    titleValue: title,
    descriptionValue: description,
    imageUrlValue: imageUrl
  });

  // FAIL EARLY if ALL fields are empty
  if (!hasValidTitle && !hasValidDescription && !hasValidImage) {
    const errorMsg = 
      'Rich card validation failed: At least one of title, description, or imageUrl must be provided with actual content. ' +
      `Received: title="${title}", description="${description}", imageUrl="${imageUrl}"`;
    console.error('[RCS] ❌', errorMsg);
    throw new Error(errorMsg);
  }

  // Build card content using Jio API field names
  const cardContent = {};
  
  if (hasValidTitle) {
    cardContent.cardTitle = title.trim();
    console.log('[RCS] ✅ Added cardTitle:', cardContent.cardTitle);
  }
  
  if (hasValidDescription) {
    cardContent.cardDescription = description.trim();
    console.log('[RCS] ✅ Added cardDescription:', cardContent.cardDescription);
  }
  
  if (hasValidImage) {
    cardContent.cardMedia = {
      mediaHeight: 'TALL',
      contentInfo: { fileUrl: imageUrl.trim() }
    };
    console.log('[RCS] ✅ Added cardMedia:', cardContent.cardMedia.contentInfo.fileUrl);
  }

  // Build suggestions (buttons)
  const suggestions = (content?.actions || [])
    .map(action => {
      const label = action.label || action.text || 'Action';
      const uri = action.uri || action.value || '';
      
      if (!label || !uri) {
        console.warn('[RCS] ⚠️ Skipping invalid action:', action);
        return null;
      }

      // URL action
      if (action.actionType === 'openUri' || uri.startsWith('http')) {
        return {
          action: {
            plainText: label,
            postBack: { data: uri },
            openUrl: {
              url: uri.startsWith('http') ? uri : `https://${uri}`
            }
          }
        };
      }
      
      // Call action
      if (action.actionType === 'dialPhone' || uri.startsWith('+')) {
        return {
          action: {
            plainText: label,
            postBack: { data: uri },
            dialerAction: {
              phoneNumber: uri.startsWith('+') ? uri : `+91${uri}`
            }
          }
        };
      }
      
      // Reply action
      return {
        reply: {
          plainText: label,
          postBack: { data: uri }
        }
      };
    })
    .filter(Boolean); // Remove null entries

  if (suggestions.length > 0) {
    cardContent.suggestions = suggestions;
    console.log('[RCS] ✅ Added', suggestions.length, 'suggestions');
  }

  console.log('[RCS] 📤 Final cardContent:', JSON.stringify(cardContent, null, 2));

  // Verify final content has at least one required field
  if (!cardContent.cardTitle && !cardContent.cardDescription && !cardContent.cardMedia) {
    throw new Error('Rich card build failed: cardContent is empty after processing');
  }

  jioContent = {
    richCardDetails: {
      standalone: {
        cardOrientation: 'VERTICAL',
        content: cardContent
      }
    }
  };
  break;
}


      case 'carousel':
        const validCards = (content?.cards || []).map(card => {
          const cardTitle = this.replaceVariables(card.title, variables);
          const cardDesc = this.replaceVariables(card.description || card.subtitle, variables);
          const cardImage = card.imageUrl;

          // Only include cards with all required fields
          if (!cardTitle?.trim() || !cardDesc?.trim() || !cardImage?.trim()) {
            return null;
          }

          const cardContent = {
            cardTitle: cardTitle.trim(),
            cardDescription: cardDesc.trim(),
            cardMedia: {
              contentInfo: { fileUrl: cardImage.trim() },
              mediaHeight: 'MEDIUM'
            }
          };

          const cardSuggestions = (card.actions || [])
            .filter(action => action.label && action.uri)
            .map(action => {
              if (action.actionType === 'openUri') {
                return {
                  action: {
                    plainText: action.label,
                    postBack: { data: 'carousel_action' },
                    openUrl: { url: action.uri }
                  }
                };
              }
              if (action.actionType === 'dialPhone') {
                // Clean and validate phone number
                let phoneNumber = action.uri.replace(/\D/g, ''); // Remove non-digits
                if (phoneNumber.length === 10) {
                  phoneNumber = `+91${phoneNumber}`;
                } else if (phoneNumber.length === 12 && phoneNumber.startsWith('91')) {
                  phoneNumber = `+${phoneNumber}`;
                } else if (!phoneNumber.startsWith('+')) {
                  phoneNumber = `+${phoneNumber}`;
                }
                
                return {
                  action: {
                    plainText: action.label,
                    postBack: { data: 'carousel_action' },
                    dialerAction: { phoneNumber }
                  }
                };
              }
              return {
                reply: {
                  plainText: action.label,
                  postBack: { data: action.uri }
                }
              };
            });

          if (cardSuggestions.length > 0) {
            cardContent.suggestions = cardSuggestions;
          }

          return cardContent;
        }).filter(Boolean);

        if (validCards.length < 2) {
          throw new Error('Carousel requires minimum 2 valid cards with title, description, and image');
        }

        jioContent = {
          richCardDetails: {
            carousel: {
              cardWidth: 'MEDIUM_WIDTH',
              contents: validCards
            }
          }
        };
        break;
        
      case 'textWithAction':
        jioContent = {
          plainText: this.replaceVariables(content?.text, variables),
          suggestions: (content?.buttons || []).map(btn => {
            if (btn.actionType === 'dialPhone') {
              return {
                action: {
                  plainText: btn.label,
                  postBack: {
                    data: btn.value,
                  },
                  dialerAction: {
                    phoneNumber: btn.value.startsWith('+') ? btn.value : `+91${btn.value}`,
                  },
                },
              };
            } else if (btn.actionType === 'openUri') {
              return {
                action: {
                  plainText: btn.label,
                  postBack: {
                    data: btn.value,
                  },
                  openUrl: {
                    url: btn.value.startsWith('http') ? btn.value : `https://${btn.value}`,
                  },
                },
              };
            } else {
              return {
                reply: {
                  plainText: btn.label,
                  postBack: {
                    data: btn.value,
                  },
                },
              };
            }
          }).filter(Boolean),
        };
        break;
        
      case 'plainText':
        jioContent = {
          plainText: this.replaceVariables(content?.body || content?.text, variables),
        };
        break;
        
      default:
        throw new Error(`Unsupported template type: ${templateType}`);
    }
    
    return {
      content: jioContent,
      ...(capabilityToken ? { capabilityToken } : {}),
    };
  }

  /**
   * Jio-friendly suggestion builder:
   * - URL: action.openUrl.url + displayText
   * - Call: action.dialPhone.phoneNumber + displayText
   * - Reply: reply.displayText + postbackData
   */
  buildSuggestion(action = {}) {
    const label = action.label || action.text || action.displayText || 'Open';

    const url = action.uri || action.url || action.value;
    const isUrl =
      action.type === 'url' ||
      (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://')));

    if (isUrl) {
      return {
        action: {
          displayText: label,
          openUrl: { url },
        },
      };
    }

    const phone = action.phoneNumber || action.value;
    const isCall = action.type === 'call' || (typeof phone === 'string' && phone.startsWith('+'));

    if (isCall) {
      return {
        action: {
          displayText: label,
          dialPhone: { phoneNumber: phone },
        },
      };
    }

    // Default: reply/postback
    return {
      reply: {
        displayText: label,
        postbackData: action.postbackData || action.value || action.uri || label,
      },
    };
  }

  // ===================== BATCH CAPABILITY CHECK =====================
  async checkBatchCapability(phoneNumbers = [], userId) {
    const results = [];

    for (const phone of phoneNumbers) {
      try {
        const cap = await this.checkCapabilityAndGetToken(phone, userId);
        results.push({
          phoneNumber: phone,
          isCapable: cap.isCapable,
          token: cap.token,
          expiresAt: cap.expiresAt,
          status: 'checked',
        });

        // small gap to avoid rate limits
        await this.sleep(500);
      } catch (error) {
        results.push({
          phoneNumber: phone,
          isCapable: false,
          token: null,
          error: error.message,
          status: 'error',
        });
      }
    }

    return results;
  }

  // ===================== CAMPAIGN BATCH PROCESSING =====================
  /**
   * Requires your Campaign model to implement:
   * - getPendingRecipients(batchSize)
   * - markRecipientAsProcessing(phoneNumber)
   * - markRecipientAsFailed(phoneNumber, reason)
   * - updateStats()
   */
  async processCampaignBatch(campaignId, batchSize = 100, delayMs = 1000) {
    try {
      const campaign = await Campaign.findById(campaignId).populate('templateId');
      if (!campaign) throw new Error('Campaign not found');

      const pendingRecipients = campaign.getPendingRecipients(batchSize);
      if (!pendingRecipients.length) return;

      for (const recipient of pendingRecipients) {
        try {
          await campaign.markRecipientAsProcessing(recipient.phoneNumber);

          // Skip if already known non-RCS capable
          if (recipient.isRcsCapable === false) {
            await campaign.markRecipientAsFailed(recipient.phoneNumber, 'Device not RCS capable (pre-checked)');
            continue;
          }

          const cap = await this.checkCapabilityAndGetToken(recipient.phoneNumber, campaign.userId);

          if (!cap.isCapable) {
            await campaign.markRecipientAsFailed(recipient.phoneNumber, 'Device not RCS capable');
            continue;
          }

          // Create message record (charge only capable numbers)
          const msgId = this.generateUUID();
          await Message.create({
            messageId: msgId,
            campaignId,
            userId: campaign.userId,
            recipientPhoneNumber: recipient.phoneNumber,
            templateId: campaign.templateId?._id,
            templateType: campaign.templateId?.templateType,
            content: campaign.templateId?.content,
            variables: recipient.variables,
            jioCapabilityToken: cap.token,
            assistantId: process.env.JIO_ASSISTANT_ID || 'default_assistant',
            status: 'queued',
            queuedAt: new Date(),
            cost: 1, // ₹1 per RCS message (your logic)
          });

          await this.messageQueue.add(
            {
              messageData: {
                phoneNumber: recipient.phoneNumber,
                messageId: msgId,
                userId: campaign.userId,
                campaignId,
                templateType: campaign.templateId?.templateType,
                content: campaign.templateId?.content,
                capabilityToken: cap.token,
                variables: recipient.variables,
              },
            },
            {
              priority: 10,
              delay: Math.floor(Math.random() * 2000),
            }
          );

          await this.sleep(delayMs);
        } catch (err) {
          console.error('[RCS] recipient error:', recipient.phoneNumber, err.message);
          await campaign.markRecipientAsFailed(recipient.phoneNumber, err.message);
        }
      }

      await campaign.updateStats();

      const stillPending = campaign.getPendingRecipients(1);
      if (stillPending.length) {
        setTimeout(() => {
          this.processCampaignBatch(campaignId, batchSize, delayMs).catch(() => {});
        }, 5000);
      } else {
        campaign.status = 'completed';
        campaign.completedAt = new Date();
        await campaign.save();
      }
    } catch (error) {
      console.error('[RCS] Error processing campaign batch:', error.message);
    }
  }

  // ===================== QUEUE HANDLERS =====================
  setupQueueHandlers() {
    this.messageQueue.process(1000, async (job) => {
      const { messageData } = job.data;
      try {
        await this.sendMessage(messageData);
        return { success: true };
      } catch (error) {
        // Let Bull retry if attempts remaining
        if (job.attemptsMade < job.opts.attempts) throw error;
        return { success: false, error: error.message };
      }
    });

    this.messageQueue.on('completed', (job) => {
      console.log(`[Queue] Message ${job.data.messageData.messageId} sent successfully`);
    });

    this.messageQueue.on('failed', (job, err) => {
      console.error(`[Queue] Message ${job.data.messageData.messageId} failed:`, err.message);
    });
  }

  // ===================== HELPERS =====================
  formatPhone(phoneNumber) {
    if (!phoneNumber) return '';
    return phoneNumber.startsWith('+') ? phoneNumber : `+91${phoneNumber}`;
  }

  replaceVariables(text, variables = {}) {
    if (!text) return '';
    let out = String(text);
    for (const [key, val] of Object.entries(variables)) {
      out = out.replace(new RegExp(`{{${key}}}`, 'g'), String(val));
    }
    return out;
  }

  generateUUID() {
    return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  getErrorType(error) {
    if (!error.response) return 'network';
    const status = error.response.status;
    if (status === 429) return 'rate_limit';
    if (status >= 400 && status < 500) return 'validation';
    if (status >= 500) return 'service';
    return 'unknown';
  }

  isTokenExpired(expiresAt) {
    return new Date(expiresAt) < new Date();
  }

  async getCachedToken(key) {
    if (!redisClient) return null;
    try {
      if (!redisClient.isOpen) await redisClient.connect();
      const data = await redisClient.get(key);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      console.error('[RCS] Redis get error:', e.message);
      return null;
    }
  }

  async cacheToken(key, tokenData) {
    if (!redisClient) return;
    try {
      if (!redisClient.isOpen) await redisClient.connect();
      await redisClient.setEx(key, 86400, JSON.stringify(tokenData)); // 24h
    } catch (e) {
      console.error('[RCS] Redis set error:', e.message);
    }
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Graceful shutdown
  async cleanup() {
    try {
      if (redisClient && redisClient.isOpen) {
        await redisClient.quit();
        console.log('[RCS] Redis client disconnected');
      }
      await this.messageQueue.close();
      console.log('[RCS] Message queue closed');
    } catch (e) {
      console.error('[RCS] Cleanup error:', e.message);
    }
  }
}

export default new JioRCSService();
