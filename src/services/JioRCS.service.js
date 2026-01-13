import axios from 'axios';
import { createClient } from 'redis';
import http from 'http';
import https from 'https';

import MessageLog from '../models/messageLog.model.js';
import User from '../models/user.model.js';

const JIOAPI_BASE_URL =
  process.env.JIO_API_BASE_URL || 'https://api.businessmessaging.jio.com';

// ===================== Redis client (optional cache) =====================
let redisClient = null;

try {
  redisClient = createClient({
    url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`,
    socket: {
      connectTimeout: 30000,
      reconnectStrategy: (retries) => Math.min(retries * 100, 3000)
    }
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
    // Simplified service - only capability checking
  }

  // ===================== TOKEN MANAGEMENT =====================
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

  // ===================== CAPABILITY CHECK =====================
  async checkCapabilityFast(phoneNumbers, accessToken) {
    const MAX_API_LIMIT = 10000;
    const CONCURRENCY = 5;

    const formatted = phoneNumbers.map(p => {
      const n = String(p).replace(/\D/g, "");
      return n.length === 10 ? `+91${n}` : n.startsWith("91") ? `+${n}` : `+91${n}`;
    });

    const uniqueNumbers = [...new Set(formatted)];

    const chunks = [];
    for (let i = 0; i < uniqueNumbers.length; i += MAX_API_LIMIT) {
      chunks.push(uniqueNumbers.slice(i, i + MAX_API_LIMIT));
    }

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
    return Array.from(capableSet);
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

  // ===================== HELPER METHODS =====================
  formatPhone(phoneNumber) {
    if (!phoneNumber) return '';
    return phoneNumber.startsWith('+') ? phoneNumber : `+91${phoneNumber}`;
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
      await redisClient.setEx(key, 86400, JSON.stringify(tokenData));
    } catch (e) {
      console.error('[RCS] Redis set error:', e.message);
    }
  }

  // Graceful shutdown
  async cleanup() {
    try {
      if (redisClient && redisClient.isOpen) {
        await redisClient.quit();
        console.log('[RCS] Redis client disconnected');
      }
    } catch (e) {
      console.error('[RCS] Cleanup error:', e.message);
    }
  }
}

export default new JioRCSService();