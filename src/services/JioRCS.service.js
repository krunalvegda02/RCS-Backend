
import axios from 'axios';
import Bull from 'bull';
import redis from 'redis';
import Message from '../models/message.model.js';
import { APIResult } from '../models/APIReport.model.js';
import Campaign from '../models/campaign.model.js';

const JIOAPI_BASE_URL = process.env.JIO_API_BASE_URL || 'https://api.businessmessaging.jio.com';
const JIO_SECRET_KEY = process.env.JIO_SECRET_KEY;
const JIO_SECRET_ID = process.env.JIO_SECRET_ID;

// Redis client for caching capability tokens
const redisClient = redis.createClient({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
});

class JioRCSService {
  constructor() {
    this.messageQueue = new Bull('jio-rcs-messages', {
      redis: { 
        host: process.env.REDIS_HOST, 
        port: process.env.REDIS_PORT 
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
      },
    });

    this.setupQueueHandlers();
  }

  // ====== CAPABILITY CHECK & TOKEN GENERATION ======
  /**
   * Check if a phone number supports RCS and get capability token
   * Critical: This must be called BEFORE sending any message
   */
  async checkCapabilityAndGetToken(phoneNumber, userId, assistantId) {
    try {
      // Check Redis cache first
      const cacheKey = `rcs_capability:${phoneNumber}:${assistantId}`;
      const cachedToken = await this.getCachedToken(cacheKey);

      if (cachedToken && !this.isTokenExpired(cachedToken.expiresAt)) {
        console.log(`[RCS] Using cached token for ${phoneNumber}`);
        return cachedToken;
      }

      // Call Jio API to check capability
      const response = await axios.post(
        `${JIOAPI_BASE_URL}/v1/messaging/users/${phoneNumber}/assistantMessages/async`,
        {
          messageId: this.generateUUID(),
          assistantId: assistantId,
          // Empty payload for capability check
          richCard: null,
        },
        {
          headers: {
            'Authorization': `Bearer ${JIO_SECRET_KEY}`,
            'X-Secret-ID': JIO_SECRET_ID,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );

      // Parse response
      const tokenData = {
        token: response.data.capabilityToken || response.data.token,
        isCapable: response.data.isCapable !== false,
        expiresAt: new Date(Date.now() + 86400000), // 24 hours
        phoneNumber: phoneNumber,
      };

      // Save to cache
      await this.cacheToken(cacheKey, tokenData);

      // Save result
      await APIResult.create({
        messageId: `capability_check_${phoneNumber}`,
        userId: userId,
        statusCode: response.status,
        status: tokenData.isCapable ? 'success' : 'unsupported',
        capabilityStatus: tokenData.isCapable ? 'rcs_capable' : 'not_capable',
        capabilityToken: tokenData.token,
        responseBody: response.data,
        responseTimeMs: response.headers['x-response-time'],
        requestTime: new Date(),
        responseTime: new Date(),
      });

      return tokenData;
    } catch (error) {
      console.error(`[RCS] Capability check failed for ${phoneNumber}:`, error.message);

      // Log failed attempt
      await APIResult.create({
        messageId: `capability_check_${phoneNumber}`,
        userId: userId,
        statusCode: error.response?.status || 500,
        status: 'failed',
        capabilityStatus: 'unknown',
        errorCode: error.response?.data?.errorCode || 'CAPABILITY_CHECK_FAILED',
        errorMessage: error.message,
        errorType: this.getErrorType(error),
        responseBody: error.response?.data,
        requestTime: new Date(),
        responseTime: new Date(),
      });

      throw error;
    }
  }

  // ====== MESSAGE SENDING ======
  /**
   * Send RCS message - handles all 4 message types
   * @param {Object} messageData - Contains recipient, template, content, etc.
   */
  async sendMessage(messageData) {
    const {
      phoneNumber,
      messageId,
      userId,
      campaignId,
      templateId,
      templateType,
      content,
      assistantId,
      capabilityToken,
      variables,
    } = messageData;

    // Query message once at the beginning
    const message = await Message.findOne({ messageId });

    try {
      // Build RCS message payload based on type
      const rcsPayload = this.buildRCSPayload(
        templateType,
        content,
        variables,
        capabilityToken
      );

      // Call Jio API
      const response = await axios.post(
        `${JIOAPI_BASE_URL}/v1/messaging/users/${phoneNumber}/assistantMessages/async?messageId=${messageId}&assistantId=${assistantId}`,
        rcsPayload,
        {
          headers: {
            'Authorization': `Bearer ${JIO_SECRET_KEY}`,
            'X-Secret-ID': JIO_SECRET_ID,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }
      );

      // Mark message as sent
      if (message) {
        await message.markAsSent(response.data.messageId || messageId);
      }

      // Save API result
      await APIResult.create({
        messageId,
        userId,
        campaignId,
        statusCode: response.status,
        status: 'success',
        responseBody: response.data,
        rcsMessageId: response.data.messageId,
        requestTime: new Date(),
        responseTime: new Date(),
        responseTimeMs: response.headers['x-response-time'],
        capabilityToken: capabilityToken,
      });

      return { success: true, rcsMessageId: response.data.messageId };
    } catch (error) {
      console.error(`[RCS] Message send failed for ${phoneNumber}:`, error.message);

      // Handle specific errors
      const errorType = this.getErrorType(error);
      const errorCode = error.response?.data?.errorCode || error.code;

      // Determine if retry needed
      const shouldRetry = ['rate_limit', 'network', 'service'].includes(errorType);

      // Save API result
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
        requestTime: new Date(),
        responseTime: new Date(),
        isRetry: false,
      });

      // Update message status
      if (message) {
        if (shouldRetry) {
          await message.scheduleRetry();
        } else {
          await message.markAsFailed(errorCode, error.message);
        }
      }

      throw error;
    }
  }

  // ====== PAYLOAD BUILDERS (4 MESSAGE TYPES) ======
  buildRCSPayload(templateType, content, variables, capabilityToken) {
    const basePayload = {
      capabilityToken: capabilityToken,
    };

    switch (templateType) {
      case 'richCard':
        return {
          ...basePayload,
          richCard: {
            cardOrientation: 'VERTICAL',
            cardHeight: 'MEDIUM',
            contents: [
              {
                title: this.replaceVariables(content.title, variables),
                description: this.replaceVariables(content.description, variables),
                media: {
                  height: 'MEDIUM',
                  contentUrl: content.imageUrl,
                },
                suggestions: content.actions.map(action => ({
                  action: {
                    text: action.label,
                    postbackData: action.uri,
                    uri: action.uri,
                  },
                  reply: {
                    displayText: action.label,
                    postbackData: action.uri,
                  },
                })),
              },
            ],
          },
        };

      case 'carousel':
        return {
          ...basePayload,
          richCard: {
            cardOrientation: 'HORIZONTAL',
            cardHeight: 'MEDIUM',
            contents: content.cards.map(card => ({
              title: this.replaceVariables(card.title, variables),
              description: this.replaceVariables(card.description, variables),
              media: {
                height: 'MEDIUM',
                contentUrl: card.imageUrl,
              },
              suggestions: card.actions.map(action => ({
                action: {
                  text: action.label,
                  postbackData: action.uri,
                  uri: action.uri,
                },
              })),
            })),
          },
        };

      case 'textWithAction':
        return {
          ...basePayload,
          richCard: {
            cardOrientation: 'VERTICAL',
            contents: [
              {
                title: this.replaceVariables(content.text, variables),
                suggestions: content.buttons.map(btn => ({
                  action: {
                    text: btn.label,
                    postbackData: btn.value,
                  },
                  reply: {
                    displayText: btn.label,
                    postbackData: btn.value,
                  },
                })),
              },
            ],
          },
        };

      case 'plainText':
        return {
          ...basePayload,
          text: this.replaceVariables(content.body, variables),
        };

      default:
        throw new Error(`Unknown message type: ${templateType}`);
    }
  }

  // ====== HELPER METHODS ======
  replaceVariables(text, variables = {}) {
    if (!text) return '';
    let result = text;
    Object.entries(variables).forEach(([key, value]) => {
      result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
    });
    return result;
  }

  generateUUID() {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  getErrorType(error) {
    if (!error.response) return 'network';
    const status = error.response.status;
    if (status === 429) return 'rate_limit';
    if (status >= 400 && status < 500) return 'validation';
    if (status >= 500) return 'service';
    return 'unknown';
  }

  async getCachedToken(key) {
    return new Promise((resolve, reject) => {
      redisClient.get(key, (err, data) => {
        if (err) reject(err);
        resolve(data ? JSON.parse(data) : null);
      });
    });
  }

  async cacheToken(key, tokenData) {
    return new Promise((resolve, reject) => {
      redisClient.setex(
        key,
        86400, // 24 hours
        JSON.stringify(tokenData),
        (err) => {
          if (err) reject(err);
          resolve();
        }
      );
    });
  }

  isTokenExpired(expiresAt) {
    return new Date(expiresAt) < new Date();
  }

  // ====== QUEUE HANDLERS ======
  setupQueueHandlers() {
    this.messageQueue.process(1000, async (job) => {
      const { messageData } = job.data;
      try {
        await this.sendMessage(messageData);
        return { success: true };
      } catch (error) {
        if (job.attemptsMade < job.opts.attempts) {
          throw error; // Let Bull retry
        }
        // Final failure
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

  // ====== BATCH CAPABILITY CHECK ======
  /**
   * Check RCS capability for multiple phone numbers at once
   * Returns array with capability status for each number
   */
  async checkBatchCapability(phoneNumbers, userId) {
    const results = [];
    const assistantId = process.env.JIO_ASSISTANT_ID || 'default_assistant';
    
    console.log(`[RCS] Checking capability for ${phoneNumbers.length} numbers`);
    
    for (const phoneNumber of phoneNumbers) {
      try {
        const capabilityData = await this.checkCapabilityAndGetToken(
          phoneNumber,
          userId,
          assistantId
        );
        
        results.push({
          phoneNumber,
          isCapable: capabilityData.isCapable,
          token: capabilityData.token,
          expiresAt: capabilityData.expiresAt,
          status: 'checked'
        });
        
        // Rate limiting between checks
        await this.sleep(500);
      } catch (error) {
        console.error(`[RCS] Capability check failed for ${phoneNumber}:`, error.message);
        results.push({
          phoneNumber,
          isCapable: false,
          token: null,
          error: error.message,
          status: 'error'
        });
      }
    }
    
    return results;
  }
  /**
   * Process campaign messages in optimized batches
   * Only processes and charges for RCS capable numbers
   */
  async processCampaignBatch(campaignId, batchSize = 100, delayMs = 1000) {
    try {
      const campaign = await Campaign.findById(campaignId).populate('templateId');
      if (!campaign) throw new Error('Campaign not found');

      // Get pending recipients (all types)
      const pendingRecipients = campaign.getPendingRecipients(batchSize);
      
      if (pendingRecipients.length === 0) {
        console.log(`[RCS] No pending recipients for campaign ${campaignId}`);
        return;
      }

      console.log(`[RCS] Processing ${pendingRecipients.length} recipients for campaign ${campaignId}`);

      for (const recipient of pendingRecipients) {
        try {
          // Mark as processing
          await campaign.markRecipientAsProcessing(recipient.phoneNumber);

          // If recipient is already marked as non-RCS capable, skip capability check
          if (recipient.isRcsCapable === false) {
            await campaign.markRecipientAsFailed(
              recipient.phoneNumber,
              'Device not RCS capable (pre-checked)'
            );
            console.log(`[RCS] Skipping non-RCS capable number: ${recipient.phoneNumber}`);
            continue;
          }

          // Check capability for this recipient (if not already checked)
          let capabilityData;
          if (recipient.isRcsCapable === true) {
            // Already verified as RCS capable, get cached token
            const cacheKey = `rcs_capability:${recipient.phoneNumber}:${process.env.JIO_ASSISTANT_ID || 'default_assistant'}`;
            capabilityData = await this.getCachedToken(cacheKey);
            
            if (!capabilityData || this.isTokenExpired(capabilityData.expiresAt)) {
              // Re-check capability if token expired
              capabilityData = await this.checkCapabilityAndGetToken(
                recipient.phoneNumber,
                campaign.userId,
                process.env.JIO_ASSISTANT_ID || 'default_assistant'
              );
            }
          } else {
            // First time capability check
            capabilityData = await this.checkCapabilityAndGetToken(
              recipient.phoneNumber,
              campaign.userId,
              process.env.JIO_ASSISTANT_ID || 'default_assistant'
            );
          }

          if (!capabilityData.isCapable) {
            await campaign.markRecipientAsFailed(
              recipient.phoneNumber,
              'Device not RCS capable'
            );
            console.log(`[RCS] Non-RCS capable number: ${recipient.phoneNumber} - NO CHARGE`);
            continue;
          }

          // Only create message and charge for RCS capable numbers
          const messageId = this.generateUUID();
          const message = await Message.create({
            messageId,
            campaignId,
            userId: campaign.userId,
            recipientPhoneNumber: recipient.phoneNumber,
            templateId: campaign.templateId._id,
            templateType: campaign.templateId.templateType,
            content: campaign.templateId.content,
            variables: recipient.variables,
            jioCapabilityToken: capabilityData.token,
            assistantId: process.env.JIO_ASSISTANT_ID || 'default_assistant',
            status: 'queued',
            queuedAt: new Date(),
            cost: 1, // ₹1 per RCS message
          });

          // Add to queue for processing
          await this.messageQueue.add(
            {
              messageData: {
                phoneNumber: recipient.phoneNumber,
                messageId,
                userId: campaign.userId,
                campaignId,
                templateId: campaign.templateId._id,
                templateType: campaign.templateId.templateType,
                content: campaign.templateId.content,
                assistantId: process.env.JIO_ASSISTANT_ID || 'default_assistant',
                capabilityToken: capabilityData.token,
                variables: recipient.variables,
              },
            },
            {
              priority: 10,
              delay: Math.random() * 2000, // Random jitter
            }
          );

          console.log(`[RCS] Queued RCS capable number: ${recipient.phoneNumber} - CHARGED ₹1`);

          // Respect rate limits
          await this.sleep(delayMs);
        } catch (error) {
          console.error(`Error processing recipient ${recipient.phoneNumber}:`, error.message);
          await campaign.markRecipientAsFailed(recipient.phoneNumber, error.message);
        }
      }

      // Update campaign stats
      await campaign.updateStats();
      
      // Check if there are more recipients to process
      const remainingRecipients = campaign.getPendingRecipients(1);
      if (remainingRecipients.length > 0) {
        // Schedule next batch
        setTimeout(() => {
          this.processCampaignBatch(campaignId, batchSize, delayMs);
        }, 5000); // 5 second delay between batches
      } else {
        // Mark campaign as completed
        campaign.status = 'completed';
        campaign.completedAt = new Date();
        await campaign.save();
        console.log(`[RCS] Campaign ${campaignId} completed`);
      }
    } catch (error) {
      console.error(`[RCS] Error processing campaign batch ${campaignId}:`, error.message);
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default new JioRCSService();
