import mongoose from 'mongoose';
import connectDB from '../db/index.js';

class CampaignStatsWorker {
  constructor() {
    this.pendingUpdates = new Map();
    this.isProcessing = false;
    this.intervalMs = 5000; // 5 seconds for high-volume
    this.maxMapSize = 30000; // Prevent memory overflow
    this.maxBatchSize = 500; // Limit bulk operations
    this.logThrottle = new Map(); // Throttle logging
    this.intervalId = null; // Store interval ID for dynamic adjustment
    this.lastFlushDuration = 0; // Track processing time
  }

  async start() {
    await connectDB();
    this.Campaign = (await import('../models/campaign.model.js')).default;
    
    console.log('✅ Campaign Stats Worker started (adaptive intervals starting at 5s)');
    
    // Start with adaptive interval scheduling
    this.scheduleNextFlush();
  }

  // High-volume optimized stats update with memory management
  addStatsUpdate(campaignId, statusChange) {
    const id = campaignId.toString();
    const { oldStatus, newStatus } = statusChange;
    
    if (oldStatus === newStatus) return;
    
    // Memory protection: Check BEFORE processing to prevent data loss
    if (this.pendingUpdates.size >= this.maxMapSize) {
      console.log(`[CampaignStats] Memory limit reached (${this.maxMapSize}), dropping update: ${id}`);
      return; // Drop this update to prevent memory overflow
    }
    
    if (!this.pendingUpdates.has(id)) {
      this.pendingUpdates.set(id, {});
    }
    
    const updates = this.pendingUpdates.get(id);
    
    // Throttled logging for high volume
    const logKey = `${id}-${oldStatus}-${newStatus}`;
    if (!this.logThrottle.has(logKey)) {
      console.log(`[CampaignStats] ${id}: ${oldStatus} → ${newStatus}`);
      this.logThrottle.set(logKey, Date.now());
      // Clear old log entries every minute
      if (this.logThrottle.size > 1000) {
        const oneMinuteAgo = Date.now() - 60000;
        for (const [key, timestamp] of this.logThrottle) {
          if (timestamp < oneMinuteAgo) this.logThrottle.delete(key);
        }
      }
    }
    
    // Define status groups for CUMULATIVE counting
    const statusGroups = {
      sent: ['sent', 'delivered', 'read', 'replied', 'failed'],
      delivered: ['delivered', 'read', 'replied'],
      read: ['read', 'replied']
    };
    
    // Handle pending decrements
    if (['pending', 'queued', 'draft'].includes(oldStatus)) {
      updates['stats.pending'] = (updates['stats.pending'] || 0) - 1;
    }
    
    // CUMULATIVE LOGIC - optimized for performance
    const wasInSent = statusGroups.sent.includes(oldStatus);
    const nowInSent = statusGroups.sent.includes(newStatus);
    if (!wasInSent && nowInSent) {
      updates['stats.sent'] = (updates['stats.sent'] || 0) + 1;
    }
    
    const wasInDelivered = statusGroups.delivered.includes(oldStatus);
    const nowInDelivered = statusGroups.delivered.includes(newStatus);
    if (!wasInDelivered && nowInDelivered) {
      updates['stats.delivered'] = (updates['stats.delivered'] || 0) + 1;
    }
    
    const wasInRead = statusGroups.read.includes(oldStatus);
    const nowInRead = statusGroups.read.includes(newStatus);
    if (!wasInRead && nowInRead) {
      updates['stats.read'] = (updates['stats.read'] || 0) + 1;
    }
    
    // Individual exact counts
    if (oldStatus !== 'replied' && newStatus === 'replied') {
      updates['stats.replied'] = (updates['stats.replied'] || 0) + 1;
    }
    if (oldStatus !== 'failed' && newStatus === 'failed') {
      updates['stats.failed'] = (updates['stats.failed'] || 0) + 1;
    }
    if (oldStatus !== 'expired' && newStatus === 'expired') {
      updates['stats.expired'] = (updates['stats.expired'] || 0) + 1;
    }
  }

  // Adaptive scheduling based on processing time
  scheduleNextFlush() {
    if (this.intervalId) {
      clearTimeout(this.intervalId);
    }
    
    // Adaptive interval: if last flush took longer, wait longer
    let nextInterval = this.intervalMs;
    if (this.lastFlushDuration > this.intervalMs) {
      nextInterval = Math.min(this.lastFlushDuration * 1.5, 30000); // Max 30s
      console.log(`[CampaignStats] Adaptive interval: ${nextInterval}ms (last flush: ${this.lastFlushDuration}ms)`);
    }
    
    this.intervalId = setTimeout(async () => {
      try {
        await this.flushPendingUpdates();
      } catch (error) {
        console.error('[CampaignStats] Flush error:', error.message);
      } finally {
        this.scheduleNextFlush(); // Always reschedule, even on error
      }
    }, nextInterval);
  }

  async flushPendingUpdates() {
    if (this.isProcessing) {
      console.log('[CampaignStats] Flush already in progress, skipping');
      return;
    }
    
    if (this.pendingUpdates.size === 0) {
      return;
    }
    
    this.isProcessing = true;
    const updates = new Map(this.pendingUpdates);
    this.pendingUpdates.clear();
    
    const startTime = Date.now();
    console.log(`[CampaignStats] Flushing ${updates.size} campaign updates`);
    
    // Process in batches to prevent MongoDB overload
    const campaignIds = Array.from(updates.keys());
    const batches = [];
    for (let i = 0; i < campaignIds.length; i += this.maxBatchSize) {
      batches.push(campaignIds.slice(i, i + this.maxBatchSize));
    }
    
    let totalUpdated = 0;
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const bulkOps = [];
      
      for (const campaignId of batch) {
        const statChanges = updates.get(campaignId);
        const incFields = {};
        
        for (const [field, change] of Object.entries(statChanges)) {
          if (change !== 0) incFields[field] = change;
        }
        
        if (Object.keys(incFields).length > 0) {
          bulkOps.push({
            updateOne: {
              filter: { _id: new mongoose.Types.ObjectId(campaignId) },
              update: { $inc: incFields }
            }
          });
        }
      }
      
      if (bulkOps.length > 0) {
        try {
          await this.Campaign.bulkWrite(bulkOps, { ordered: false });
          totalUpdated += bulkOps.length;
        } catch (error) {
          console.error(`[CampaignStats] Batch ${batchIndex + 1} error:`, error.message);
        }
      }
    }
    
    const duration = Date.now() - startTime;
    this.lastFlushDuration = duration; // Store for adaptive scheduling
    console.log(`[CampaignStats] Updated ${totalUpdated} campaigns in ${duration}ms (${batches.length} batches)`);
    
    this.isProcessing = false;
  }
}

export default new CampaignStatsWorker();