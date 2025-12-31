
import axios from 'axios';
import Bull from 'bull';
import { createClient } from 'redis';

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
        errorCode: error.response?.data?.errorCode || 'CAPABILITY_CHECK_FAILED',
        errorMessage: error.message,
        errorType: this.getErrorType(error),
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

      await MessageLog.logMessageSend({
        messageId,
        campaignId,
        userId,
        success: false,
        statusCode: error.response?.status || 500,
        errorCode,
        errorMessage: error.message,
        errorType,
        retryCount: message?.retryCount || 0,
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

  // ===================== CAMPAIGN BATCH PROCESSING (OPTIMIZED FOR 1 LAKH+) =====================
  /**
   * High-performance campaign processing with dynamic concurrency
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

      const pendingRecipients = campaign.getPendingRecipients(batchSize);
      if (!pendingRecipients.length) {
        console.log(`[RCS] No pending recipients for campaign ${campaignId}`);
        // Mark campaign as completed if no pending recipients
        await Campaign.updateOne(
          { _id: campaignId, status: 'running' },
          { status: 'completed', completedAt: new Date() }
        );
        return;
      }

      console.log(`[RCS] Processing batch of ${pendingRecipients.length} recipients for campaign ${campaignId}`);

      // Process recipients in parallel with controlled concurrency
      const concurrency = Math.min(50, Math.max(5, Math.floor(batchSize / 10)));
      const chunks = this.chunkArray(pendingRecipients, concurrency);

      for (const chunk of chunks) {
        const promises = chunk.map(async (recipient) => {
          try {
            // Mark as processing to prevent duplicate processing
            await Campaign.updateOne(
              { 
                _id: campaignId,
                'recipients.phoneNumber': recipient.phoneNumber,
                'recipients.status': 'pending'
              },
              { 
                $set: { 'recipients.$.status': 'processing' }
              }
            );

            // Skip capability check since frontend sends pre-validated contacts
            if (recipient.isRcsCapable === false) {
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
              return;
            }

            // Use existing capability token or skip check for pre-validated numbers
            let capabilityToken = null;
            if (recipient.isRcsCapable === true) {
              // For pre-validated numbers, we can skip the capability check
              console.log(`[RCS] Using pre-validated RCS capable number: ${recipient.phoneNumber}`);
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
                return;
              }
            }

            // Create message record (charge only capable numbers)
            const msgId = this.generateUUID();
            const messageDoc = {
              messageId: msgId,
              campaignId,
              userId: campaign.userId,
              recipientPhoneNumber: recipient.phoneNumber,
              templateId: campaign.templateId?._id,
              templateType: campaign.templateId?.templateType,
              content: campaign.templateId?.content,
              variables: recipient.variables,
              jioCapabilityToken: capabilityToken,
              assistantId: process.env.JIO_ASSISTANT_ID || 'default_assistant',
              status: 'queued',
              queuedAt: new Date(),
              cost: 1, // ₹1 per RCS message
            };

            await Message.create(messageDoc);

            // Update campaign recipient with messageId
            await Campaign.updateOne(
              { 
                _id: campaignId,
                'recipients.phoneNumber': recipient.phoneNumber
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

            await this.messageQueue.add(
              {
                messageData: {
                  phoneNumber: recipient.phoneNumber,
                  messageId: msgId,
                  userId: campaign.userId,
                  campaignId,
                  templateType: campaign.templateId?.templateType,
                  content: campaign.templateId?.content,
                  capabilityToken: capabilityToken,
                  variables: recipient.variables,
                },
              },
              {
                priority,
                delay: Math.floor(Math.random() * (delayMs * 2)),
                attempts: 3,
                backoff: { type: 'exponential', delay: 2000 }
              }
            );

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
          }
        });

        // Wait for current chunk to complete before processing next
        await Promise.allSettled(promises);
        
        // Reduced delay for pre-validated contacts
        const chunkDelay = campaign.recipients.length > 50000 ? 100 : 
                          campaign.recipients.length > 10000 ? 200 : 500;
        await this.sleep(chunkDelay);
      }

      // Update campaign stats after processing batch - use direct aggregation for efficiency
      // Skip stats update here as it will be handled by the background worker and real-time Redis stats

      // Continue processing remaining recipients
      const stillPending = campaign.getPendingRecipients(1);
      if (stillPending.length > 0) {
        const nextDelay = campaign.recipients.length > 50000 ? 1000 : 2000;
        setTimeout(() => {
          this.processCampaignBatch(campaignId, batchSize, delayMs).catch(error => {
            console.error(`[RCS] Batch processing error for ${campaignId}:`, error);
            // Mark campaign as failed on critical error
            Campaign.updateOne(
              { _id: campaignId },
              { status: 'failed', completedAt: new Date() }
            ).catch(console.error);
          });
        }, nextDelay);
      } else {
        // All recipients processed, mark campaign as completed
        await Campaign.updateOne(
          { _id: campaignId },
          { status: 'completed', completedAt: new Date() }
        );
        console.log(`[RCS] ✅ Campaign ${campaignId} completed successfully`);
      }
    } catch (error) {
      console.error('[RCS] Error processing campaign batch:', error.message);
      // Mark campaign as failed on critical error
      await Campaign.updateOne(
        { _id: campaignId },
        { status: 'failed', completedAt: new Date() }
      ).catch(console.error);
    }
  }

  // ===================== QUEUE HANDLERS (HIGH CONCURRENCY) =====================
  setupQueueHandlers() {
    // Dynamic concurrency based on system load and campaign size
    const maxConcurrency = process.env.NODE_ENV === 'production' ? 2000 : 1000;
    
    this.messageQueue.process(maxConcurrency, async (job) => {
      const { messageData } = job.data;
      try {
        const result = await this.sendMessage(messageData);
        
        // Increment stats in Redis for real-time updates
        if (result.success && messageData.campaignId) {
          const statsService = await import('./CampaignStatsService.js');
          await statsService.default.incrementStat(messageData.campaignId, 'sent');
        }
        
        return result;
      } catch (error) {
        // Increment failed stats
        if (messageData.campaignId) {
          const statsService = await import('./CampaignStatsService.js');
          await statsService.default.incrementStat(messageData.campaignId, 'failed');
        }
        
        // Let Bull retry if attempts remaining
        if (job.attemptsMade < job.opts.attempts) {
          console.log(`[Queue] Retrying message ${messageData.messageId} (attempt ${job.attemptsMade + 1}/${job.opts.attempts})`);
          throw error;
        }
        
        console.error(`[Queue] Message ${messageData.messageId} failed permanently:`, error.message);
        return { success: false, error: error.message };
      }
    });

    this.messageQueue.on('completed', (job, result) => {
      if (job.id % 1000 === 0) { // Log every 1000th message for large campaigns
        console.log(`[Queue] Processed ${job.id} messages`);
      }
    });

    this.messageQueue.on('failed', (job, err) => {
      console.error(`[Queue] Message ${job.data.messageData.messageId} failed permanently:`, err.message);
    });

    // Monitor queue health for large campaigns
    this.messageQueue.on('stalled', (job) => {
      console.warn(`[Queue] Job ${job.id} stalled, will retry`);
    });

    // Log queue stats periodically for large campaigns
    setInterval(async () => {
      try {
        const waiting = await this.messageQueue.getWaiting();
        const active = await this.messageQueue.getActive();
        const completed = await this.messageQueue.getCompleted();
        const failed = await this.messageQueue.getFailed();
        
        if (waiting.length > 0 || active.length > 0) {
          console.log(`[Queue Stats] Waiting: ${waiting.length}, Active: ${active.length}, Completed: ${completed.length}, Failed: ${failed.length}`);
        }
      } catch (error) {
        console.error('[Queue] Error getting stats:', error.message);
      }
    }, 30000); // Every 30 seconds
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
