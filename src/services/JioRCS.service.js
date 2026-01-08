
import axios from 'axios';
import Bull from 'bull';
import { createClient } from 'redis';
import mongoose from 'mongoose';
import http from 'http';
import https from 'https';

import Message from '../models/message.model.js';
import MessageLog from '../models/messageLog.model.js';
import Campaign from '../models/campaign.model.js';
import User from '../models/user.model.js';
import ContactBatch from '../models/contactBatch.model.js';

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
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
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


  async checkCapabilityFast(phoneNumbers, accessToken) {
    const MAX_API_LIMIT = 10000;   // Jio limit
    const CONCURRENCY = 5;         // safe parallel calls

    /* ---------- format numbers ---------- */
    const formatted = phoneNumbers.map(p => {
      const n = String(p).replace(/\D/g, "");
      return n.length === 10 ? `+91${n}` : n.startsWith("91") ? `+${n}` : `+91${n}`;
    });

    const uniqueNumbers = [...new Set(formatted)];

    /* ---------- chunking ---------- */
    const chunks = [];
    for (let i = 0; i < uniqueNumbers.length; i += MAX_API_LIMIT) {
      chunks.push(uniqueNumbers.slice(i, i + MAX_API_LIMIT));
    }

    /* ---------- axios (KEEP ALIVE) ---------- */
    const axiosInstance = axios.create({
      timeout: 60000,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      httpAgent: new http.Agent({
        keepAlive: true,
        maxSockets: CONCURRENCY,
      }),
      httpsAgent: new https.Agent({
        keepAlive: true,
        maxSockets: CONCURRENCY,
      }),
    });

    /* ---------- parallel worker pool ---------- */
    let index = 0;
    const capableSet = new Set();

    const workers = Array(CONCURRENCY).fill(null).map(async () => {
      while (index < chunks.length) {
        const i = index++;
        const res = await axiosInstance.post(
          "https://api.businessmessaging.jio.com/v1/messaging/usersBatchGet",
          { phoneNumbers: chunks[i] }
        );

        const reachable = res.data?.reachableUsers || [];
        for (const num of reachable) capableSet.add(num);
      }
    });

    await Promise.all(workers);

    /* ---------- return ONLY capable numbers ---------- */
    return Array.from(capableSet);
  }



  async checkCapabilityBatch(phoneNumbers, userId, onProgress = null) {
    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        const user = await User.findById(userId).select('+jioConfig.clientSecret');
        if (!user || !user.jioConfig?.isConfigured) {
          throw new Error('Jio RCS not configured for this user');
        }

        const accessToken = await this.getAccessToken(userId);
        const formattedNumbers = phoneNumbers.map(phone => {
          const cleanPhone = String(phone).replace(/\D/g, '');
          if (cleanPhone.length === 10) return `+91${cleanPhone}`;
          if (cleanPhone.length === 12 && cleanPhone.startsWith('91')) return `+${cleanPhone}`;
          return phone.startsWith('+') ? phone : `+91${cleanPhone}`;
        });

        const uniqueNumbers = [...new Set(formattedNumbers)];
        console.log(`[RCS] Batch checking ${uniqueNumbers.length} unique numbers (attempt ${attempt + 1}/${maxRetries})...`);

        // Optimal batching: 500-10000 range
        const MAX_BATCH_SIZE = 10000;
        const MIN_BATCH_SIZE = 500;
        const total = uniqueNumbers.length;
        const chunks = [];
        let remaining = total;
        let processed = 0;

        while (remaining > 0) {
          if (remaining <= MAX_BATCH_SIZE) {
            chunks.push(uniqueNumbers.slice(processed));
            break;
          }

          const afterThisChunk = remaining - MAX_BATCH_SIZE;
          if (afterThisChunk > 0 && afterThisChunk < MIN_BATCH_SIZE) {
            const adjustedSize = MAX_BATCH_SIZE - (MIN_BATCH_SIZE - afterThisChunk);
            chunks.push(uniqueNumbers.slice(processed, processed + adjustedSize));
            processed += adjustedSize;
            remaining -= adjustedSize;
          } else {
            chunks.push(uniqueNumbers.slice(processed, processed + MAX_BATCH_SIZE));
            processed += MAX_BATCH_SIZE;
            remaining -= MAX_BATCH_SIZE;
          }
        }

        console.log(`[RCS] Optimal batches: ${chunks.length} chunks:`, chunks.map(c => c.length));

        const allResults = [];
        let totalRcsCapable = 0;
        const realPhoneSet = new Set(uniqueNumbers);

        // Create axios instance with better connection handling (reuse for all chunks)
        const axiosInstance = axios.create({
          timeout: 90000, // Increased timeout
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Connection': 'close', // Force connection close after request
            'User-Agent': 'RCS-Service/1.0'
          },
          // Better connection management
          httpAgent: new http.Agent({
            keepAlive: false,
            maxSockets: 1
          }),
          httpsAgent: new https.Agent({
            keepAlive: false,
            maxSockets: 1,
            rejectUnauthorized: true
          })
        });

        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          console.log(`[RCS] Processing chunk ${i + 1}/${chunks.length} with ${chunk.length} numbers`);

          let chunkResponse;
          let chunkAttempt = 0;
          const maxChunkRetries = 2;

          while (chunkAttempt < maxChunkRetries) {
            try {
              chunkResponse = await axiosInstance.post(
                'https://api.businessmessaging.jio.com/v1/messaging/usersBatchGet',
                { phoneNumbers: chunk }
              );
              break; // Success, exit retry loop
            } catch (chunkError) {
              chunkAttempt++;
              console.error(`[RCS] Chunk ${i + 1} attempt ${chunkAttempt} failed:`, chunkError.code || chunkError.message);

              if (chunkError.code === 'EPIPE' || chunkError.code === 'ECONNRESET' || chunkError.code === 'ETIMEDOUT') {
                if (chunkAttempt < maxChunkRetries) {
                  console.log(`[RCS] Retrying chunk ${i + 1} in 2 seconds...`);
                  await this.sleep(2000);
                  continue;
                }
              }
              throw chunkError; // Re-throw if not retryable or max retries reached
            }
          }

          const apiResponse = chunkResponse.data;
          console.log(apiResponse);

          // Directly push to database if campaignId is available
          if (global.currentCampaignId && global.currentUserId) {
            try {
              // Fetch current batch to calculate cumulative RCS capable count
              const currentBatch = await ContactBatch.findOne({
                campaignId: global.currentCampaignId,
                userId: global.currentUserId
              });

              // Count all RCS capable from existing chunks + current chunk
              const allReachableUsers = new Set();
              if (currentBatch?.apiResponse) {
                currentBatch.apiResponse.forEach(chunk => {
                  if (chunk.reachableUsers) {
                    chunk.reachableUsers.forEach(phone => allReachableUsers.add(phone));
                  }
                });
              }

              // Add current chunk's reachable users
              if (apiResponse?.reachableUsers) {
                apiResponse.reachableUsers.forEach(phone => allReachableUsers.add(phone));
              }

              await ContactBatch.updateMany(
                { campaignId: global.currentCampaignId, userId: global.currentUserId },
                {
                  $push: {
                    apiResponse: {
                      chunkNumber: i + 1,
                      reachableUsers: apiResponse?.reachableUsers || [],
                      totalRandomSampleUserCount: apiResponse?.totalRandomSampleUserCount || 0,
                      reachableRandomSampleUserCount: apiResponse?.reachableRandomSampleUserCount || 0,
                      processedAt: new Date()
                    }
                  },
                  $set: {
                    processedContacts: allResults.length,
                    rcsCapableCount: allReachableUsers.size,
                    status: i === chunks.length - 1 ? 'completed' : 'processing',
                    processingCompletedAt: i === chunks.length - 1 ? new Date() : undefined
                  }
                },
              );
              console.log(`[RCS] ✅ Pushed API response for chunk ${i + 1}, Total RCS capable: ${allReachableUsers.size}/${allResults.length}`);
            } catch (dbError) {
              console.error(`[RCS] Failed to push API response to database:`, dbError.message);
            }
          }

          const reachableUsers = apiResponse?.reachableUsers || [];

          // Ensure reachableUsers is an array
          const reachableUsersArray = Array.isArray(reachableUsers) ? reachableUsers : [];

          const chunkRcsCapable = reachableUsersArray.length;
          totalRcsCapable += chunkRcsCapable;

          console.log(`[RCS] ✅ Found ${chunkRcsCapable} RCS-capable out of ${chunk.filter(p => realPhoneSet.has(p)).length} real numbers`);

          const chunkResults = chunk.map(phone => ({
            phoneNumber: phone,
            isCapable: reachableUsersArray.includes(phone),
            features: reachableUsersArray.includes(phone) ? ['RCS_MESSAGING'] : [],
            capabilityToken: null,
            checkedAt: new Date()
          }));

          allResults.push(...chunkResults);

          // Call progress callback if provided
          if (onProgress) {
            onProgress({
              chunk: i + 1,
              totalChunks: chunks.length,
              processed: allResults.length,
              total: uniqueNumbers.length,
              rcsCapable: totalRcsCapable,
              chunkResults: chunkResults,
              apiResponse: {
                chunkNumber: i + 1,
                reachableUsers: apiResponse?.reachableUsers || [],
                totalRandomSampleUserCount: apiResponse?.totalRandomSampleUserCount || 0,
                reachableRandomSampleUserCount: apiResponse?.reachableRandomSampleUserCount || 0,
                processedAt: new Date()
              }
            });
          }

          // Add delay between chunks to prevent overwhelming the API
          if (i < chunks.length - 1) {
            await this.sleep(1000); // 1 second delay between chunks
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
        attempt++;
        console.error(`[RCS] Batch capability check attempt ${attempt} failed:`, {
          code: error.code,
          message: error.message,
          status: error.response?.status,
          data: error.response?.data
        });

        // Check if this is a retryable error
        const isRetryable = (
          error.code === 'EPIPE' ||
          error.code === 'ECONNRESET' ||
          error.code === 'ETIMEDOUT' ||
          error.code === 'ENOTFOUND' ||
          error.code === 'EAI_AGAIN' ||
          (error.response?.status >= 500 && error.response?.status < 600) ||
          error.response?.status === 429
        );

        if (isRetryable && attempt < maxRetries) {
          const backoffDelay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Exponential backoff, max 10s
          console.log(`[RCS] Retrying in ${backoffDelay}ms... (attempt ${attempt + 1}/${maxRetries})`);
          await this.sleep(backoffDelay);
          continue;
        }

        // If not retryable or max retries reached, throw the error
        throw error;
      }
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

      // Create axios instance with better connection handling for message sending
      const axiosInstance = axios.create({
        timeout: 30000, // 30 second timeout
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Connection': 'close', // Force connection close
          'User-Agent': 'RCS-Service/1.0'
        },
        // Better connection management
        httpAgent: new http.Agent({
          keepAlive: false,
          maxSockets: 1
        }),
        httpsAgent: new https.Agent({
          keepAlive: false,
          maxSockets: 1,
          rejectUnauthorized: true
        })
      });

      let response;
      let sendAttempt = 0;
      const maxSendRetries = 2;

      while (sendAttempt < maxSendRetries) {
        try {
          response = await axiosInstance.post(url, rcsPayload);
          break; // Success, exit retry loop
        } catch (sendError) {
          sendAttempt++;
          console.error(`[RCS] Send attempt ${sendAttempt} failed for ${formattedPhone}:`, sendError.code || sendError.message);

          if ((sendError.code === 'EPIPE' || sendError.code === 'ECONNRESET' || sendError.code === 'ETIMEDOUT') && sendAttempt < maxSendRetries) {
            console.log(`[RCS] Retrying message send in 1 second...`);
            await this.sleep(1000);
            continue;
          }
          throw sendError; // Re-throw if not retryable or max retries reached
        }
      }

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

        // CRITICAL: Also store Jio RCS messageId in ContactCampaignMessage for webhook lookup
        const jioMessageId = response.data?.messageId;
        if (jioMessageId && campaignId) {
          try {
            await Message.updateOne(
              {
                'campaigns.messageId': messageId,
                'campaigns.campaignId': campaignId
              },
              {
                $set: {
                  'campaigns.$.rcsMessageId': jioMessageId,
                  'campaigns.$.jioMessageId': jioMessageId
                }
              }
            );
            console.log(`[RCS] 💾 Stored Jio messageId ${jioMessageId} for webhook lookup`);
          } catch (updateError) {
            console.error(`[RCS] Failed to store Jio messageId:`, updateError.message);
          }
        }
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
          await this.refundUser(userId, 1, 'pre-send failure');
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
                return {
                  action: {
                    plainText: action.label,
                    postBack: { data: 'carousel_action' },
                    dialerAction: { phoneNumber: this.formatPhoneForAction(action.uri) }
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
            return {
              action: {
                plainText: label,
                postBack: { data: value },
                dialerAction: { phoneNumber: this.formatPhoneForAction(value) }
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
   * Smart capability check with dynamic batching - always uses batch API (500-10000 range)
   * @param {Array} phoneNumbers - Array of phone numbers to check
   * @param {String} userId - User ID
   * @param {String} campaignId - Optional campaign ID for saving results
   * @param {Number} batchNumber - Optional batch number for saving results
   * @param {Function} onProgress - Optional callback for progress updates
   */
  async checkCapabilitySmart(phoneNumbers, userId, campaignId = null, batchNumber = null, onProgress = null) {
    if (!Array.isArray(phoneNumbers)) {
      phoneNumbers = [phoneNumbers];
    }

    const uniqueNumbers = [...new Set(phoneNumbers)];
    console.log(`[RCS] Using dynamic batch API for ${uniqueNumbers.length} unique numbers`);

    // Use the new method that saves results
    if (campaignId && batchNumber !== null) {
      return await this.checkCapabilityBatchWithSave(uniqueNumbers, userId, campaignId, batchNumber, onProgress);
    } else {
      return await this.checkCapabilityWithDynamicBatching(uniqueNumbers, userId, onProgress);
    }
  }

  async checkCapabilityWithDynamicBatching(phoneNumbers, userId, onProgress = null) {
    const actualCount = phoneNumbers.length;

    if (actualCount < 500) {
      console.log(`[RCS] Small batch (${actualCount}), using sequential API`);
      return await this.checkCapabilitySequential(phoneNumbers, userId);
    }

    console.log(`[RCS] Large batch (${actualCount}), using batch API with optimal batching`);
    return await this.checkCapabilityBatch(phoneNumbers, userId, onProgress);
  }



  async saveCapabilityResults(campaignId, userId, batchNumber, phoneNumbers, capabilityResults) {
    try {
      const rcsCapableCount = capabilityResults.filter(r => r.isCapable).length;

      const updateResult = await ContactBatch.updateOne(
        {
          campaignId,
          userId,
          batchNumber
        },
        {
          $set: {
            capabilityResults: capabilityResults,
            processedContacts: phoneNumbers.length,
            rcsCapableCount: rcsCapableCount,
            status: 'completed',
            processingCompletedAt: new Date()
          }
        },
        { upsert: false }
      );

      if (updateResult.matchedCount === 0) {
        throw new Error(`ContactBatch not found for campaign ${campaignId}, batch ${batchNumber}`);
      }

      console.log(`[RCS] ✅ Saved ${capabilityResults.length} capability results to batch ${batchNumber}`);
      return updateResult;
    } catch (error) {
      console.error(`[RCS] Failed to save capability results:`, error.message);
      throw error;
    }
  }




  /**
   * Batch capability check with database persistence
   */
  async checkCapabilityBatchWithSave(phoneNumbers, userId, campaignId = null, batchNumber = null, onProgress = null) {
    try {
      // Perform capability check
      const results = await this.checkCapabilityBatch(phoneNumbers, userId, onProgress);

      // Save results to database if campaignId and batchNumber provided
      if (campaignId && batchNumber !== null) {
        await this.saveCapabilityResults(campaignId, userId, batchNumber, phoneNumbers, results);
      }

      return results;
    } catch (error) {
      console.error(`[RCS] Batch capability check with save failed:`, error.message);
      throw error;
    }
  }

  async checkCapabilitySequential(phoneNumbers, userId) {
    console.log(`[RCS] Sequential checking ${phoneNumbers.length} numbers`);
    const accessToken = await this.getAccessToken(userId);
    const results = [];

    for (const phone of phoneNumbers) {
      try {
        const formattedPhone = this.formatPhone(phone);
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

        results.push({
          phoneNumber: formattedPhone,
          isCapable: Array.isArray(response.data?.features) && response.data.features.length > 0,
          cached: false,
          features: response.data?.features || [],
          capabilityToken: response.data?.capabilityToken || null
        });
      } catch (error) {
        results.push({
          phoneNumber: this.formatPhone(phone),
          isCapable: false,
          cached: false,
          features: [],
          error: error.message
        });
      }
    }

    return results;
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
              await this.refundUser(campaign.userId, 1, 'non-RCS capable');

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
                  await this.refundUser(campaign.userId, 1, 'non-capable device');

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
                await this.refundUser(campaign.userId, 1, 'capability check failure');

                return;
              }
            }

            // Create message record (charge only capable numbers)
            const msgId = this.generateMessageId();
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
            await this.refundUser(campaign.userId, 1, 'recipient error');
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
          const phone = this.normalizePhoneForComparison(msg.recipientPhoneNumber);
          messageMap.set(phone, msg);
        });

        // Sync recipient statuses with message statuses
        let needsUpdate = false;
        for (const recipient of campaign.recipients) {
          const phone = this.normalizePhoneForComparison(recipient.phoneNumber);
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

  // Helper method to refund user wallet
  async refundUser(userId, amount = 1, reason = 'Message failure') {
    try {
      const user = await User.findById(userId);
      if (user) {
        user.wallet.blockedBalance = Math.max(0, (user.wallet.blockedBalance || 0) - amount);
        user.wallet.balance += amount;
        user.wallet.lastUpdated = new Date();
        await user.save();
        console.log(`[RCS] 🔄 Refunded ₹${amount} for ${reason}`);
      }
    } catch (refundError) {
      console.error(`[RCS] Refund error:`, refundError);
    }
  }

  // Helper method to format phone numbers consistently
  formatPhoneForAction(phoneNumber) {
    // Remove all non-digits
    let cleanPhone = phoneNumber.replace(/\D/g, '');

    // Format to +91 prefix
    if (cleanPhone.length === 10) {
      return `+91${cleanPhone}`;
    } else if (cleanPhone.length === 12 && cleanPhone.startsWith('91')) {
      return `+${cleanPhone}`;
    } else if (!cleanPhone.startsWith('+')) {
      return `+${cleanPhone}`;
    }

    return cleanPhone.startsWith('+') ? cleanPhone : `+91${cleanPhone}`;
  }

  // Helper method to normalize phone numbers for comparison
  normalizePhoneForComparison(phoneNumber) {
    return phoneNumber.replace(/^\+91/, '').replace(/^\+/, '');
  }
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

  generateMessageId() {
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
      if (!redisClient.isOpen) {
        await redisClient.connect();
      }
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
      if (!redisClient.isOpen) {
        await redisClient.connect();
      }
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
