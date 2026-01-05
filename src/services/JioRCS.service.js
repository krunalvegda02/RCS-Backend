
import axios from 'axios';
import Bull from 'bull';
import { createClient } from 'redis';
import mongoose from 'mongoose';

import Message from '../models/message.model.js';
import MessageLog from '../models/messageLog.model.js';
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
  redisClient = createClient({
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
   * Checks RCS capability status without caching - for real-time status checks
   */
  async checkCapabilityStatus(phoneNumber, userId) {
    try {
      const user = await User.findById(userId).select('+jioConfig.clientSecret');
      if (!user || !user.jioConfig?.isConfigured) {
        throw new Error('Jio RCS not configured for this user');
      }

      const formattedPhone = this.formatPhone(phoneNumber);
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

      const statusData = {
        phoneNumber: formattedPhone,
        isCapable: Array.isArray(response.data?.features) && response.data.features.length > 0,
        features: response.data?.features || [],
        capabilityToken: response.data?.capabilityToken || null,
        checkedAt: new Date(),
        statusCode: response.status
      };

      return statusData;
    } catch (error) {
      // Only log non-404 errors (404 = not RCS capable, which is normal)
      if (error.response?.status !== 404) {
        console.error(`[RCS] Capability check failed for ${phoneNumber}:`, error.message);
      }

      return {
        phoneNumber: this.formatPhone(phoneNumber),
        isCapable: false,
        features: [],
        capabilityToken: null,
        checkedAt: new Date(),
        error: error.message,
        statusCode: error.response?.status || 500
      };
    }
  }

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

      const assistantId = user.jioConfig.assistantId || process.env.JIO_ASSISTANT_ID;
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
      await MessageLog.logCapabilityCheck({
        messageId: `capability_check_${formattedPhone}`,
        userId: userId,
        isCapable: tokenData.isCapable,
        statusCode: response.status,
        token: tokenData.token,
        responseTimeMs: response.headers['x-response-time'],
      });

      return tokenData;
    } catch (error) {
      console.error(`[RCS] Capability check failed for ${phoneNumber}:`, error.message);

      await MessageLog.logCapabilityCheck({
        messageId: `capability_check_${phoneNumber}`,
        userId: userId,
        isCapable: false,
        statusCode: error.response?.status || 500,
        error: {
          code: error.response?.data?.errorCode || 'CAPABILITY_CHECK_FAILED',
          message: error.message,
          type: this.getErrorType(error)
        }
      });

      throw error;
    }
  }

  /**
   * Send a single RCS message (all types).
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
    const {
      phoneNumber,
      messageId,
      userId,
      campaignId,
      templateId,
      templateType,
      content,
      variables,
      capabilityToken,
    } = messageData;

    // Find existing message record (created in processCampaignBatch)
    let message = await Message.findOne({ messageId });
    if (!message) {
      console.error(`[RCS] Message record not found: ${messageId}`);
      throw new Error('Message record not found');
    }

    // Update status to processing (will change to 'sent' only via webhook)
    if (message.status === 'queued') {
      message.status = 'processing';
      await message.save();
    }

    let rcsPayload = null;

    try {
      const user = await User.findById(userId).select('+jioConfig.clientSecret');
      if (!user || !user.jioConfig?.isConfigured) {
        throw new Error('Jio RCS not configured for this user');
      }

      const assistantId = user.jioConfig.assistantId || process.env.JIO_ASSISTANT_ID || 'default_assistant';
      const formattedPhone = this.formatPhone(phoneNumber);

      console.log(`[RCS] 📤 Sending message to ${formattedPhone} (messageId: ${messageId})`);
      console.log(`[RCS] 📋 Campaign: ${campaignId || 'N/A'}, Template: ${templateType}`);
      console.log(`[RCS] 👤 User: ${userId}, Assistant: ${assistantId}`);

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

      // console.log(`[RCS] API URL: ${url}`);
      // console.log(`[RCS] Payload:`, JSON.stringify(rcsPayload, null, 2));

      const response = await axios.post(url, rcsPayload, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      });

      // console.log(`[RCS] 📬 API Response:+++==========================`, response.data);
      // console.log(`[RCS] ✅ Message API call successful for ${formattedPhone}`);
      // console.log(`[RCS] 📨 RCS Message ID: ${response.data?.messageId || messageId}`);

      // Keep status as 'processing' - will change to 'sent' only via MESSAGE_SENT webhook
      if (response.data.success === false) {
        await message.markAsFailed('SEND_FAILED', response.data.message || 'Message send failed');
      } else if (message) {
        // Store RCS message ID but keep status as 'processing'
        message.rcsMessageId = response.data?.messageId || messageId;
        await message.save();
        // console.log(`[RCS] 💾 Message kept in 'processing' status, awaiting MESSAGE_SENT webhook`);
      }

      // Keep campaign recipient status as 'processing' - will update via webhook
      if (campaignId) {
        try {
          const campaign = await Campaign.findById(campaignId);
          if (campaign) {
            // Status remains 'processing' until MESSAGE_SENT webhook
            // console.log(`[RCS] 📊 Campaign recipient kept in 'processing' status`);
          }
        } catch (campaignError) {
          console.error(`[RCS] Failed to check campaign:`, campaignError.message);
        }
      }

      try {
        await MessageLog.logMessageSend({
          messageId,
          campaignId,
          userId,
          success: true,
          statusCode: response.status,
          rcsMessageId: response.data?.messageId,
          capabilityToken: finalCapabilityToken,
          assistantId,
          responseTimeMs: response.headers['x-response-time'],
        });
        // console.log(`[RCS] 📝 Message log created successfully`);
      } catch (logError) {
        console.error(`[RCS] Failed to create message log:`, logError.message);
      }

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

      try {
        await MessageLog.logMessageSend({
          messageId,
          campaignId,
          userId,
          success: false,
          statusCode: error.response?.status || 500,
          error: {
            code: errorCode,
            message: error.message,
            type: errorType
          },
          retryCount: message?.retryCount || 0,
        });
        console.log(`[RCS] 📝 Error message log created`);
      } catch (logError) {
        console.error(`[RCS] Failed to create error message log:`, logError.message);
      }

      if (message) {
        if (shouldRetry) {
          await message.scheduleRetry();
        } else {
          await message.markAsFailed(errorCode, error.message);
          
          // Unblock and refund (move from blocked back to wallet)
          try {
            const user = await User.findById(userId);
            if (user) {
              user.wallet.blockedBalance = Math.max(0, (user.wallet.blockedBalance || 0) - 1);
              user.wallet.balance += 1;
              user.wallet.lastUpdated = new Date();
              await user.save();
              console.log(`[RCS] 🔄 Refunded ₹1 for pre-send failure`);
            }
          } catch (error) {
            console.error(`[RCS] Refund error:`, error);
          }
        }
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
        const textSuggestions = (content?.buttons || []).map(btn => {
          const label = btn.label || btn.text || 'Action';
          const value = btn.value || btn.uri || '';

          if (!label || !value) {
            console.warn('[RCS] ⚠️ Skipping invalid button:', btn);
            return null;
          }

          if (btn.actionType === 'dialPhone') {
            // Clean and format phone number
            let phoneNumber = value.replace(/\D/g, ''); // Remove non-digits
            if (phoneNumber.length === 10) {
              phoneNumber = `+91${phoneNumber}`;
            } else if (!phoneNumber.startsWith('+')) {
              phoneNumber = `+${phoneNumber}`;
            }

            return {
              action: {
                plainText: label,
                postBack: { data: value },
                dialerAction: { phoneNumber }
              }
            };
          } else if (btn.actionType === 'openUri') {
            // Ensure URL has protocol
            const url = value.startsWith('http') ? value : `https://${value}`;

            return {
              action: {
                plainText: label,
                postBack: { data: value },
                openUrl: { url }
              }
            };
          } else {
            // Reply/postback action
            return {
              reply: {
                plainText: label,
                postBack: { data: value }
              }
            };
          }
        }).filter(Boolean);

        jioContent = {
          plainText: this.replaceVariables(content?.text || content?.body, variables),
          ...(textSuggestions.length > 0 ? { suggestions: textSuggestions } : {})
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

  // ===================== SMART CAPABILITY CHECK =====================
  /**
   * Smart capability check - uses single API for <500 numbers, batch API for ≥500 numbers
   * @param {Array} phoneNumbers - Array of phone numbers to check
   * @param {String} userId - User ID
   * @param {Function} onProgress - Optional callback for progress updates: (chunk, totalChunks, rcsCapable, processed) => {}
   */
  async checkCapabilitySmart(phoneNumbers, userId, onProgress = null) {
    if (!Array.isArray(phoneNumbers)) {
      phoneNumbers = [phoneNumbers];
    }

    const uniqueNumbers = [...new Set(phoneNumbers)];
    
    if (uniqueNumbers.length >= 500) {
      console.log(`[RCS] Using batch API for ${uniqueNumbers.length} unique numbers`);
      return await this.checkCapabilityBatch(uniqueNumbers, userId, onProgress);
    }
    
    console.log(`[RCS] Padding ${uniqueNumbers.length} numbers to 500 for batch API`);
    return await this.checkCapabilityWithDynamicBatching(uniqueNumbers, userId, onProgress);
  }

  async checkCapabilityWithDynamicBatching(phoneNumbers, userId) {
    const MIN_BATCH_SIZE = 500;
    const actualCount = phoneNumbers.length;
    const dummyCount = MIN_BATCH_SIZE - actualCount;
    const dummyNumbers = [];
    
    for (let i = 0; i < dummyCount; i++) {
      const randomNum = `9${Math.floor(Math.random() * 900000000) + 100000000}`;
      dummyNumbers.push(`+91${randomNum}`);
    }
    
    console.log(`[RCS] Padding ${actualCount} real + ${dummyCount} dummy = ${MIN_BATCH_SIZE} total`);
    
    const paddedNumbers = [...phoneNumbers.map(p => {
      const cleanPhone = String(p).replace(/\D/g, '');
      return cleanPhone.length === 10 ? `+91${cleanPhone}` : (p.startsWith('+') ? p : `+91${cleanPhone}`);
    }), ...dummyNumbers];
    
    const batchResults = await this.checkCapabilityBatch(paddedNumbers, userId);
    
    const realPhones = new Set(phoneNumbers.map(p => {
      const cleanPhone = String(p).replace(/\D/g, '');
      return cleanPhone.length === 10 ? `+91${cleanPhone}` : (p.startsWith('+') ? p : `+91${cleanPhone}`);
    }));
    
    const realResults = batchResults.filter(r => realPhones.has(r.phoneNumber));
    console.log(`[RCS] Returned ${realResults.length} real results`);
    
    return realResults;
  }

  /**
   * Sequential capability check using single number API
   */
  async checkCapabilitySequential(phoneNumbers, userId) {
    const results = [];

    for (const phone of phoneNumbers) {
      try {
        const result = await this.checkCapabilityStatus(phone, userId);
        results.push({
          phoneNumber: phone,
          isCapable: result.isCapable,
          cached: false, // Single API calls are not cached in this context
          features: result.features,
          capabilityToken: result.capabilityToken
        });
      } catch (error) {
        results.push({
          phoneNumber: phone,
          isCapable: false,
          cached: false,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Batch capability check using actual Jio batch API with optimized chunking
   * @param {Function} onProgress - Optional callback for progress updates
   */
  async checkCapabilityBatch(phoneNumbers, userId, onProgress = null) {
    try {
      const user = await User.findById(userId).select('+jioConfig.clientSecret');
      if (!user || !user.jioConfig?.isConfigured) {
        throw new Error('Jio RCS not configured for this user');
      }

      const accessToken = await this.getAccessToken(userId);
      // Ensure proper E.164 formatting with +91 prefix
      const formattedNumbers = phoneNumbers.map(phone => {
        const cleanPhone = String(phone).replace(/\D/g, '');
        if (cleanPhone.length === 10) {
          return `+91${cleanPhone}`;
        } else if (cleanPhone.length === 12 && cleanPhone.startsWith('91')) {
          return `+${cleanPhone}`;
        } else if (cleanPhone.startsWith('91') && cleanPhone.length === 12) {
          return `+${cleanPhone}`;
        }
        return phone.startsWith('+') ? phone : `+91${cleanPhone}`;
      });

      // Remove duplicates
      const uniqueNumbers = [...new Set(formattedNumbers)];
      console.log(`[RCS] Batch checking ${uniqueNumbers.length} unique numbers...`);

      // Optimized chunking: ALL chunks must be 500-10000, never exceed 10000
      const chunks = [];
      const total = uniqueNumbers.length;
      
      if (total <= 10000) {
        // Single chunk
        chunks.push(uniqueNumbers);
      } else {
        // Multiple chunks needed
        let offset = 0;
        
        while (offset < total) {
          const remaining = total - offset;
          
          if (remaining <= 10000) {
            // Last portion
            if (remaining >= 500) {
              // Valid chunk, take all
              chunks.push(uniqueNumbers.slice(offset));
            } else {
              // <500, adjust previous chunk
              const prevChunk = chunks.pop();
              const combined = prevChunk.length + remaining;
              const splitAt = Math.ceil(combined / 2);
              chunks.push(prevChunk.slice(0, splitAt));
              chunks.push([...prevChunk.slice(splitAt), ...uniqueNumbers.slice(offset)]);
            }
            break;
          } else {
            // Take 10000 and continue
            chunks.push(uniqueNumbers.slice(offset, offset + 10000));
            offset += 10000;
          }
        }
      }

      console.log(`[RCS] Split into ${chunks.length} chunks:`, chunks.map(c => c.length));

      const allResults = [];
      let totalRcsCapable = 0;

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        console.log(`[RCS] Processing chunk ${i + 1}/${chunks.length} with ${chunk.length} numbers`);

        const response = await axios.post(
          'https://api.businessmessaging.jio.com/v1/messaging/usersBatchGet',
          { phoneNumbers: chunk },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            timeout: 60000,
          }
        );

        const reachableUsers = response.data?.reachableUsers || [];
        const chunkRcsCapable = reachableUsers.length;
        totalRcsCapable += chunkRcsCapable;
        
        console.log(`[RCS] ✅ Found ${chunkRcsCapable} RCS-capable out of ${chunk.length}`);

        const chunkResults = chunk.map(phone => ({
          phoneNumber: phone,
          isCapable: reachableUsers.includes(phone),
          features: reachableUsers.includes(phone) ? ['RCS_MESSAGING'] : [],
          capabilityToken: null
        }));

        allResults.push(...chunkResults);
        
        // Call progress callback if provided
        if (onProgress) {
          onProgress({
            chunk: i + 1,
            totalChunks: chunks.length,
            processed: allResults.length,
            total: uniqueNumbers.length,
            rcsCapable: totalRcsCapable
          });
        }
      }

      // Map results back to original numbers (including duplicates)
      const results = formattedNumbers.map(phone => {
        const batchResult = allResults.find(r => r.phoneNumber === phone);
        return {
          phoneNumber: phone,
          isCapable: batchResult?.isCapable || false,
          cached: false,
          features: batchResult?.features || [],
          capabilityToken: batchResult?.capabilityToken || null
        };
      });

      return results;
    } catch (error) {
      console.error(`[RCS] Batch capability check failed:`, error.response?.data || error.message);
      throw error;
    }
  }

  // ===================== CAMPAIGN MANAGEMENT =====================
  /**
   * Restart campaign processing for draft/paused campaigns
   */
  async restartCampaign(campaignId) {
    try {
      const campaign = await Campaign.findById(campaignId);
      if (!campaign) {
        throw new Error('Campaign not found');
      }

      // Update campaign status to running
      await Campaign.updateOne(
        { _id: campaignId },
        {
          status: 'running',
          startedAt: new Date()
        }
      );

      console.log(`[RCS] 🚀 Restarting campaign ${campaignId}`);

      // Start processing immediately
      setImmediate(() => {
        this.processCampaignBatch(campaignId, 100, 1000)
          .catch(error => {
            console.error(`[RCS] Campaign restart failed:`, error);
          });
      });

      return { success: true, message: 'Campaign restarted' };
    } catch (error) {
      console.error(`[RCS] Failed to restart campaign:`, error.message);
      throw error;
    }
  }

  // ===================== CAMPAIGN BATCH PROCESSING (OPTIMIZED FOR 1 LAKH+) =====================
  /**
   * High-performance campaign processing with fixed batch size of 100
   */
  async processCampaignBatch(campaignId, batchSize = 100, delayMs = 1000) {
    try {
      const campaign = await Campaign.findById(campaignId).populate('templateId');
      if (!campaign) {
        console.error(`[RCS] Campaign ${campaignId} not found`);
        return;
      }

      if (campaign.status !== 'running') {
        console.log(`[RCS] Campaign ${campaignId} is not running (status: ${campaign.status})`);
        return;
      }

      const pendingRecipients = campaign.getPendingRecipients(100);
      if (!pendingRecipients.length) {
        console.log(`[RCS] No pending recipients for campaign ${campaignId}`);
        // Mark campaign as completed if no pending recipients
        const campaignToComplete = await Campaign.findById(campaignId);
        if (campaignToComplete && campaignToComplete.status === 'running') {
          // Update stats before completing
          await campaignToComplete.updateStats();
          
          // Reload after updateStats
          const freshCampaign = await Campaign.findById(campaignId);
          if (freshCampaign && freshCampaign.status === 'running') {
            freshCampaign.status = 'completed';
            freshCampaign.completedAt = new Date();
            await freshCampaign.save();
            console.log(`[RCS] ✅ Campaign marked as completed, blocked balance cleaned up`);
          }
        }
        return;
      }

      console.log(`[RCS] Processing batch of ${pendingRecipients.length} recipients (max 100) for campaign ${campaignId}`);

      // Process recipients in parallel - optimized for 200/sec
      const concurrency = 50; // 50 concurrent batch processing
      const chunks = this.chunkArray(pendingRecipients, concurrency);

      for (const chunk of chunks) {
        const promises = chunk.map(async (recipient) => {
          try {
            // Mark as processing to prevent duplicate processing (atomic update)
            const processingUpdate = await Campaign.updateOne(
              {
                _id: campaignId,
                'recipients.phoneNumber': recipient.phoneNumber,
                'recipients.status': 'pending'
              },
              {
                $set: { 'recipients.$.status': 'processing' }
              }
            );

            // Skip if already being processed by another worker
            if (processingUpdate.modifiedCount === 0) {
              console.log(`[RCS] Recipient ${recipient.phoneNumber} already being processed, skipping`);
              return;
            }

            // Skip capability check since frontend sends pre-validated contacts
            if (recipient.isRcsCapable === false) {
              console.log(`[RCS] ❌ Skipping non-RCS capable contact: ${recipient.phoneNumber}`);
              await Campaign.updateOne(
                {
                  _id: campaignId,
                  'recipients.phoneNumber': recipient.phoneNumber
                },
                {
                  $set: {
                    'recipients.$.status': 'failed',
                    'recipients.$.failureReason': 'Device not RCS capable (pre-validated)',
                    'recipients.$.failedAt': new Date()
                  }
                }
              );
              
                  // Unblock and refund (move from blocked back to wallet)
              try {
                const user = await User.findById(campaign.userId);
                if (user) {
                  user.wallet.blockedBalance = Math.max(0, (user.wallet.blockedBalance || 0) - 1);
                  user.wallet.balance += 1;
                  user.wallet.lastUpdated = new Date();
                  await user.save();
                  console.log(`[RCS] 🔄 Refunded ₹1 for non-RCS capable`);
                }
              } catch (error) {
                console.error(`[RCS] Refund error:`, error);
              }
              
              return;
            }

            // Use existing capability token or skip check for pre-validated numbers
            let capabilityToken = null;
            if (recipient.isRcsCapable === true) {
              // For pre-validated numbers, we can skip the capability check
              console.log(`[RCS] ✅ Using pre-validated RCS capable number: ${recipient.phoneNumber}`);
            } else {
              // Only check capability if not pre-validated
              try {
                const cap = await this.checkCapabilityAndGetToken(recipient.phoneNumber, campaign.userId);
                if (!cap.isCapable) {
                  await Campaign.updateOne(
                    {
                      _id: campaignId,
                      'recipients.phoneNumber': recipient.phoneNumber
                    },
                    {
                      $set: {
                        'recipients.$.status': 'failed',
                        'recipients.$.failureReason': 'Device not RCS capable',
                        'recipients.$.failedAt': new Date()
                      }
                    }
                  );
                  
                  // Unblock and refund (move from blocked back to wallet)
                  try {
                    const user = await User.findById(campaign.userId);
                    if (user) {
                      user.wallet.blockedBalance = Math.max(0, (user.wallet.blockedBalance || 0) - 1);
                      user.wallet.balance += 1;
                      user.wallet.lastUpdated = new Date();
                      await user.save();
                      console.log(`[RCS] 🔄 Refunded ₹1 for non-capable device`);
                    }
                  } catch (error) {
                    console.error(`[RCS] Refund error:`, error);
                  }
                  
                  return;
                }
                capabilityToken = cap.token;
              } catch (capError) {
                console.error(`[RCS] Capability check failed for ${recipient.phoneNumber}:`, capError.message);
                await Campaign.updateOne(
                  {
                    _id: campaignId,
                    'recipients.phoneNumber': recipient.phoneNumber
                  },
                  {
                    $set: {
                      'recipients.$.status': 'failed',
                      'recipients.$.failureReason': `Capability check failed: ${capError.message}`,
                      'recipients.$.failedAt': new Date()
                    }
                  }
                );
                
                // Unblock and refund (move from blocked back to wallet)
                try {
                  const user = await User.findById(campaign.userId);
                  if (user) {
                    user.wallet.blockedBalance = Math.max(0, (user.wallet.blockedBalance || 0) - 1);
                    user.wallet.balance += 1;
                    user.wallet.lastUpdated = new Date();
                    await user.save();
                    console.log(`[RCS] 🔄 Refunded ₹1 for capability check failure`);
                  }
                } catch (error) {
                  console.error(`[RCS] Refund error:`, error);
                }
                
                return;
              }
            }

            // Create message record (charge only capable numbers)
            const msgId = this.generateUUID();
            console.log(`[RCS] 📝 Creating message record for ${recipient.phoneNumber} (ID: ${msgId})`);
            const messageDoc = {
              messageId: msgId,
              campaignId,
              userId: campaign.userId,
              recipientPhoneNumber: recipient.phoneNumber,
              templateId: campaign.templateId?._id || campaign.templateId,
              templateType: campaign.templateId?.templateType,
              content: campaign.templateId?.content,
              variables: recipient.variables,
              jioCapabilityToken: capabilityToken,
              assistantId: process.env.JIO_ASSISTANT_ID || 'default_assistant',
              status: 'queued',
              queuedAt: new Date(),
              cost: 1, // ₹1 per RCS message
            };

            // Create message and update recipient atomically to prevent duplicates
            await Message.create(messageDoc);
            console.log(`[RCS] 💾 Message record created and queued for processing`);

            // Update campaign recipient with messageId (only if still in processing state)
            await Campaign.updateOne(
              {
                _id: campaignId,
                'recipients.phoneNumber': recipient.phoneNumber,
                'recipients.status': 'processing'
              },
              {
                $set: {
                  'recipients.$.messageId': msgId,
                  'recipients.$.status': 'queued'
                }
              }
            );

            // Add to queue with priority based on campaign size
            const priority = campaign.recipients.length > 50000 ? 5 :
              campaign.recipients.length > 10000 ? 7 : 10;

            const queueDelay = Math.floor(Math.random() * (delayMs * 2));
            await this.messageQueue.add(
              {
                messageData: {
                  phoneNumber: recipient.phoneNumber,
                  messageId: msgId,
                  userId: campaign.userId,
                  campaignId,
                  templateId: campaign.templateId?._id || campaign.templateId,
                  templateType: campaign.templateId?.templateType,
                  content: campaign.templateId?.content,
                  capabilityToken: capabilityToken,
                  variables: recipient.variables,
                },
              },
              {
                priority,
                delay: queueDelay,
                attempts: 3,
                backoff: { type: 'exponential', delay: 2000 }
              }
            );
            console.log(`[RCS] 🚀 Message queued for sending (delay: ${queueDelay}ms, priority: ${priority})`);

          } catch (err) {
            console.error('[RCS] recipient error:', recipient.phoneNumber, err.message);
            await Campaign.updateOne(
              {
                _id: campaignId,
                'recipients.phoneNumber': recipient.phoneNumber
              },
              {
                $set: {
                  'recipients.$.status': 'failed',
                  'recipients.$.failureReason': err.message,
                  'recipients.$.failedAt': new Date()
                }
              }
            );
            
            // Unblock and refund (move from blocked back to wallet)
            try {
              const user = await User.findById(campaign.userId);
              if (user) {
                user.wallet.blockedBalance = Math.max(0, (user.wallet.blockedBalance || 0) - 1);
                user.wallet.balance += 1;
                user.wallet.lastUpdated = new Date();
                await user.save();
                console.log(`[RCS] 🔄 Refunded ₹1 for recipient error`);
              }
            } catch (error) {
              console.error(`[RCS] Refund error:`, error);
            }
          }
        });

        // Wait for current chunk to complete before processing next
        await Promise.allSettled(promises);

        // Minimal delay between chunks for 200/sec throughput
        const chunkDelay = 250; // 250ms delay between chunks
        await this.sleep(chunkDelay);
      }

      // Update campaign stats after processing batch
      const updatedCampaign = await Campaign.findById(campaignId);
      if (updatedCampaign) {
        await updatedCampaign.updateStats();
        
        // Reload campaign after updateStats to get fresh data
        const freshCampaign = await Campaign.findById(campaignId);
        if (!freshCampaign) return;
        
        // Check if there are any recipients still needing processing (including queued)
        const stillPending = freshCampaign.recipients.filter(r => 
          r.status === 'pending' || r.status === 'processing' || r.status === 'queued'
        );
        
        if (stillPending.length > 0 && freshCampaign.status === 'running') {
          console.log(`[RCS] ${stillPending.length} recipients still pending/queued, continuing...`);
          const nextDelay = 500;
          setTimeout(() => {
            this.processCampaignBatch(campaignId, 100, delayMs).catch(error => {
              console.error(`[RCS] Batch processing error for ${campaignId}:`, error);
              console.error(`[RCS] Error stack:`, error.stack);
              console.log(`[RCS] Campaign will continue with partial results`);
            });
          }, nextDelay);
        } else if (freshCampaign.status === 'running') {
          // All recipients processed (sent, delivered, read, or failed)
          freshCampaign.status = 'completed';
          freshCampaign.completedAt = new Date();
          await freshCampaign.save();
          console.log(`[RCS] ✅ Campaign ${campaignId} completed successfully`);
        }
      }
    } catch (error) {
      console.error('[RCS] Error processing campaign batch:', error.message);
      console.error('[RCS] Error stack:', error.stack);
      console.error('[RCS] Campaign ID:', campaignId);
      // Don't mark campaign as failed - individual message failures are tracked per recipient
      // Campaign will be marked as completed when all batches finish processing
      console.log(`[RCS] Campaign batch error logged, continuing with remaining recipients`);
    }
  }

  // ===================== QUEUE HANDLERS (200 MSG/SEC RATE LIMITING) =====================
  setupQueueHandlers() {
    // 200 messages per second = 200 concurrent with 5ms delay
    const maxConcurrency = 200;

    this.messageQueue.process(maxConcurrency, async (job) => {
      const { messageData } = job.data;

      // 5ms delay = 200 messages per second
      await this.sleep(5);

      try {
        const result = await this.sendMessage(messageData);
        return result;
      } catch (error) {
        // Handle rate limiting
        if (error.response?.status === 429) {
          console.log(`[Queue] Rate limited, backing off`);
          await this.sleep(1000);
          throw error;
        }

        if (job.attemptsMade < job.opts.attempts) {
          throw error;
        }

        return { success: false, error: error.message };
      }
    });

    this.messageQueue.on('completed', (job, result) => {
      if (job.id % 1000 === 0) { // Log every 1000th message for large campaigns
        console.log(`[Queue] Processed ${job.id} messages`);
      }
    });

    this.messageQueue.on('failed', async (job, err) => {
      console.error(`[Queue] Message ${job.data.messageData.messageId} failed permanently:`, err.message);
      
      const { campaignId, phoneNumber, messageId } = job.data.messageData;
      if (!campaignId) return;
      
      try {
        // Update campaign recipient status
        await Campaign.updateOne(
          { _id: campaignId, 'recipients.phoneNumber': phoneNumber },
          {
            $set: {
              'recipients.$.status': 'failed',
              'recipients.$.failureReason': err.message,
              'recipients.$.failedAt': new Date()
            }
          }
        );
        
        // Update message status
        await Message.updateOne(
          { messageId },
          { 
            status: 'failed',
            errorCode: err.response?.status === 429 ? 'RATE_LIMIT' : 'SEND_FAILED',
            errorMessage: err.message,
            failedAt: new Date()
          }
        );
        
        // Refund wallet
        const campaign = await Campaign.findById(campaignId);
        if (campaign) {
          const user = await User.findById(campaign.userId);
          if (user) {
            user.wallet.blockedBalance = Math.max(0, (user.wallet.blockedBalance || 0) - 1);
            user.wallet.balance += 1;
            user.wallet.lastUpdated = new Date();
            await user.save();
            console.log(`[Queue] 🔄 Refunded ₹1 for failed message`);
          }
          
          // Update stats immediately after failure
          await campaign.updateStats();
          console.log(`[Queue] 📊 Campaign stats updated after failure`);
        }
        
        // Check if campaign should complete
        await this.checkAndCompleteCampaign(campaignId);
      } catch (updateError) {
        console.error(`[Queue] Failed to update campaign:`, updateError.message);
      }
    });

    // Monitor queue health
    this.messageQueue.on('stalled', (job) => {
      console.warn(`[Queue] Job ${job.id} stalled, will retry`);
    });

    // Periodic queue stats and campaign completion check
    setInterval(async () => {
      try {
        const waiting = await this.messageQueue.getWaiting();
        const active = await this.messageQueue.getActive();
        const completed = await this.messageQueue.getCompleted();
        const failed = await this.messageQueue.getFailed();

        if (waiting.length > 0 || active.length > 0) {
          console.log(`[Queue Stats] Waiting: ${waiting.length}, Active: ${active.length}, Completed: ${completed.length}, Failed: ${failed.length}`);
        }
        
        // Check for stuck campaigns every 30 seconds
        await this.checkStuckCampaigns();
      } catch (error) {
        console.error('[Queue] Error getting stats:', error.message);
      }
    }, 30000); // Every 30 seconds
  }

  // Check if campaign should be completed
  async checkAndCompleteCampaign(campaignId) {
    try {
      const campaign = await Campaign.findById(campaignId);
      if (!campaign || campaign.status !== 'running') return;
      
      const stillPending = campaign.recipients.filter(r => 
        r.status === 'pending' || r.status === 'processing' || r.status === 'queued'
      );
      
      if (stillPending.length === 0) {
        // Update stats (this saves the campaign)
        await campaign.updateStats();
        
        // Reload to get fresh data after updateStats save
        const freshCampaign = await Campaign.findById(campaignId);
        if (freshCampaign && freshCampaign.status === 'running') {
          freshCampaign.status = 'completed';
          freshCampaign.completedAt = new Date();
          await freshCampaign.save();
          console.log(`[RCS] ✅ Campaign ${campaignId} auto-completed`);
        }
      }
    } catch (error) {
      console.error(`[RCS] Error checking campaign completion:`, error.message);
    }
  }

  // Check for stuck campaigns and complete them
  async checkStuckCampaigns() {
    try {
      const runningCampaigns = await Campaign.find({ status: 'running' });
      
      for (const campaign of runningCampaigns) {
        // Get actual message statuses
        const messages = await Message.find({ campaignId: campaign._id });
        const messageMap = new Map();
        messages.forEach(msg => {
          const phone = msg.recipientPhoneNumber.replace(/^\+91/, '').replace(/^\+/, '');
          messageMap.set(phone, msg);
        });
        
        // Sync recipient statuses with message statuses
        let needsUpdate = false;
        for (const recipient of campaign.recipients) {
          const phone = recipient.phoneNumber.replace(/^\+91/, '').replace(/^\+/, '');
          const message = messageMap.get(phone);
          
          if (message && recipient.status === 'queued' && message.status !== 'queued') {
            recipient.status = message.status;
            if (message.sentAt) recipient.sentAt = message.sentAt;
            if (message.deliveredAt) recipient.deliveredAt = message.deliveredAt;
            if (message.readAt) recipient.readAt = message.readAt;
            needsUpdate = true;
          }
        }
        
        // Save synced statuses first
        if (needsUpdate) {
          await campaign.save();
          console.log(`[RCS] 🔄 Synced campaign ${campaign._id} recipient statuses`);
        }
        
        // Check if should complete
        const stillPending = campaign.recipients.filter(r => 
          r.status === 'pending' || r.status === 'processing' || r.status === 'queued'
        );
        
        if (stillPending.length === 0) {
          // Reload campaign to get fresh data, then update stats
          const freshCampaign = await Campaign.findById(campaign._id);
          if (freshCampaign) {
            await freshCampaign.updateStats();
            
            freshCampaign.status = 'completed';
            freshCampaign.completedAt = new Date();
            await freshCampaign.save();
            console.log(`[RCS] ✅ Campaign ${campaign._id} auto-completed (stuck check)`);
          }
        }
      }
    } catch (error) {
      console.error('[RCS] Error checking stuck campaigns:', error.message);
    }
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

  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
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
