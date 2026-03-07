import mongoose from 'mongoose';
import connectDB from '../db/index.js';

class CampaignStatsWorker {
  constructor() {
    this.pendingUpdates = new Map(); // campaignId -> { delivered: +1, failed: +1, etc }
    this.isProcessing = false;
    this.intervalMs = 10000; // 10 seconds
  }

  async start() {
    await connectDB();
    this.Campaign = (await import('../models/campaign.model.js')).default;
    
    console.log('✅ Campaign Stats Worker started (incremental updates every 10s)');
    
    setInterval(() => {
      this.flushPendingUpdates();
    }, this.intervalMs);
  }

  // Add incremental stat changes with proper overlapping logic (prevents double counting)
  addStatsUpdate(campaignId, statusChange) {
    const id = campaignId.toString();
    if (!this.pendingUpdates.has(id)) {
      this.pendingUpdates.set(id, {});
    }
    
    const updates = this.pendingUpdates.get(id);
    const { oldStatus, newStatus } = statusChange;
    
    // Define status groups for overlapping logic
    const statusGroups = {
      sent: ['sent', 'delivered', 'read', 'replied', 'failed'],
      delivered: ['delivered', 'read', 'replied'],
      read: ['read', 'replied']
    };
    
    // Only decrement if oldStatus was actually pending
    if (oldStatus === 'pending') {
      updates['stats.pending'] = (updates['stats.pending'] || 0) - 1;
    }
    
    if (newStatus && oldStatus !== newStatus) {
      // Handle overlapping groups - only increment if not already in that group
      
      // Sent group: increment only if old status wasn't in sent group
      if (statusGroups.sent.includes(newStatus) && !statusGroups.sent.includes(oldStatus)) {
        updates['stats.sent'] = (updates['stats.sent'] || 0) + 1;
      }
      
      // Delivered group: increment only if old status wasn't in delivered group  
      if (statusGroups.delivered.includes(newStatus) && !statusGroups.delivered.includes(oldStatus)) {
        updates['stats.delivered'] = (updates['stats.delivered'] || 0) + 1;
      }
      
      // Read group: increment only if old status wasn't in read group
      if (statusGroups.read.includes(newStatus) && !statusGroups.read.includes(oldStatus)) {
        updates['stats.read'] = (updates['stats.read'] || 0) + 1;
      }
      
      // Individual exact counts - always safe to increment
      if (newStatus === 'replied' && oldStatus !== 'replied') {
        updates['stats.replied'] = (updates['stats.replied'] || 0) + 1;
      }
      if (newStatus === 'failed' && oldStatus !== 'failed') {
        updates['stats.failed'] = (updates['stats.failed'] || 0) + 1;
      }
      if (newStatus === 'expired' && oldStatus !== 'expired') {
        updates['stats.expired'] = (updates['stats.expired'] || 0) + 1;
      }
    }
  }

  async flushPendingUpdates() {
    if (this.isProcessing || this.pendingUpdates.size === 0) return;
    
    this.isProcessing = true;
    const updates = new Map(this.pendingUpdates);
    this.pendingUpdates.clear();
    
    console.log(`[CampaignStats] Flushing ${updates.size} campaign updates`);
    
    const bulkOps = [];
    for (const [campaignId, statChanges] of updates) {
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
        console.log(`[CampaignStats] Updated ${bulkOps.length} campaigns`);
      } catch (error) {
        console.error('[CampaignStats] Bulk update error:', error.message);
      }
    }
    
    this.isProcessing = false;
  }
}

export default new CampaignStatsWorker();