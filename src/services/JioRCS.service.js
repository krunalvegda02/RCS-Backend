import axios from 'axios';
import http from 'http';
import https from 'https';

import MessageLog from '../models/messageLog.model.js';
import User from '../models/user.model.js';

const JIOAPI_BASE_URL =
  process.env.JIO_API_BASE_URL || 'https://api.businessmessaging.jio.com';


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
    const MIN_BATCH_SIZE = 500;
    const CONCURRENCY = 30;

    const formatted = phoneNumbers.map(p => {
      const n = String(p).replace(/\D/g, "");
      return n.length === 10 ? `+91${n}` : n.startsWith("91") ? `+${n}` : `+91${n}`;
    });

    const uniqueNumbers = [...new Set(formatted)];

    // Smart batching to ensure all chunks are 500-10000
    const chunks = this.createSmartBatches(uniqueNumbers, MIN_BATCH_SIZE, MAX_API_LIMIT);

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
  createSmartBatches(numbers, minSize, maxSize) {
    // Examples of smart batching:
    // 20200 contacts: [10000, 9600, 600] instead of [10000, 10000, 200]
    // 15300 contacts: [10000, 5300] instead of [10000, 5300] (already good)
    // 10200 contacts: [5100, 5100] instead of [10000, 200]
    // 30400 contacts: [10000, 10000, 10200, 200] → [10000, 10000, 5200, 5200]
    // 450 contacts: [450] (uses sequential API instead)
    
    if (numbers.length <= maxSize) {
      return [numbers];
    }

    const chunks = [];
    let i = 0;
    
    while (i < numbers.length) {
      const remaining = numbers.length - i;
      
      if (remaining <= maxSize) {
        // Last chunk - check if it's too small
        if (remaining < minSize && chunks.length > 0) {
          // Merge with previous chunk if combined size <= maxSize
          const lastChunk = chunks[chunks.length - 1];
          if (lastChunk.length + remaining <= maxSize) {
            chunks[chunks.length - 1] = [...lastChunk, ...numbers.slice(i)];
            break;
          }
          // Otherwise redistribute last two chunks
          const prevChunk = chunks.pop();
          const combined = [...prevChunk, ...numbers.slice(i)];
          const half = Math.floor(combined.length / 2);
          chunks.push(combined.slice(0, half), combined.slice(half));
          break;
        }
        chunks.push(numbers.slice(i));
        break;
      }
      
      chunks.push(numbers.slice(i, i + maxSize));
      i += maxSize;
    }
    
    return chunks;
  }

  formatPhone(phoneNumber) {
    if (!phoneNumber) return '';
    return phoneNumber.startsWith('+') ? phoneNumber : `+91${phoneNumber}`;
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default new JioRCSService();