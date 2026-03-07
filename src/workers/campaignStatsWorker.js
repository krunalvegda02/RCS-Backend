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

  // Correct cumulative counting logic - delivered never decreases when read
  addStatsUpdate(campaignId, statusChange) {
    const id = campaignId.toString();
    if (!this.pendingUpdates.has(id)) {
      this.pendingUpdates.set(id, {});
    }
    
    const updates = this.pendingUpdates.get(id);
    const { oldStatus, newStatus } = statusChange;
    
    // Skip if no actual change
    if (oldStatus === newStatus) return;
    
    console.log(`[CampaignStats] ${id}: ${oldStatus} → ${newStatus}`);
    
    // Define status groups for CUMULATIVE counting (matches syncCampaignStats.js)
    const statusGroups = {
      sent: ['sent', 'delivered', 'read', 'replied', 'failed'],      // All non-pending
      delivered: ['delivered', 'read', 'replied'],                   // All delivered+ 
      read: ['read', 'replied']                                      // All read+
    };
    
    // Handle pending decrements
    if (['pending', 'queued', 'draft'].includes(oldStatus)) {
      updates['stats.pending'] = (updates['stats.pending'] || 0) - 1;
    }
    
    // CUMULATIVE LOGIC: Only increment when entering a group, never decrement
    
    // SENT group: increment when first entering sent group
    const wasInSent = statusGroups.sent.includes(oldStatus);
    const nowInSent = statusGroups.sent.includes(newStatus);
    if (!wasInSent && nowInSent) {
      updates['stats.sent'] = (updates['stats.sent'] || 0) + 1;
    }
    
    // DELIVERED group: increment when first entering delivered group
    const wasInDelivered = statusGroups.delivered.includes(oldStatus);
    const nowInDelivered = statusGroups.delivered.includes(newStatus);
    if (!wasInDelivered && nowInDelivered) {
      updates['stats.delivered'] = (updates['stats.delivered'] || 0) + 1;
    }
    
    // READ group: increment when first entering read group
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