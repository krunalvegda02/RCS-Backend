
import mongoose from 'mongoose';

const campaignSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Campaign name is required'],
      trim: true,
      maxlength: 100,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    templateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Template',
      required: true,
    },

    // Master/Sub Campaign Structure
    isMaster: {
      type: Boolean,
      default: false,
      index: true
    },
    masterCampaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      index: true
    },
    subCampaignIndex: Number,

    // Campaign Status
    status: {
      type: String,
      enum: ['draft', 'pending', 'processing', 'running', 'completed', 'failed'],
      default: 'pending',
      index: true,
    },

    completedAt: Date,

    // Statistics (cached for performance)
    stats: {
      total: {
        type: Number,
        default: 0,
      },
      sent: {
        type: Number,
        default: 0,
      },
      delivered: {
        type: Number,
        default: 0,
      },
      read: {
        type: Number,
        default: 0,
      },
      replied: {
        type: Number,
        default: 0,
      },
      failed: {
        type: Number,
        default: 0,
      },
      bounced: {
        type: Number,
        default: 0,
      },
    },

    payload: {
      type: String, 
    },

    // Budget/Rate Limit
    estimatedCost: {
      type: Number,
      default: 0,
    },
    actualCost: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    collection: 'campaigns',
  }
);

// Indexes
campaignSchema.index({ userId: 1, status: 1 });
campaignSchema.index({ templateId: 1 });
campaignSchema.index({ createdAt: -1 });
campaignSchema.index({ masterCampaignId: 1, isMaster: 1 });

// Sync stats from ContactCampaignMessage
campaignSchema.methods.syncStats = async function () {
  const ContactCampaignMessage = (await import('./message.model.js')).default;
  
  // If this is a sub-campaign, sync from messages
  if (!this.isMaster) {
    const stats = await ContactCampaignMessage.aggregate([
      { $match: { userId: this.userId, 'campaigns.campaignId': this._id } },
      { $unwind: '$campaigns' },
      { $match: { 'campaigns.campaignId': this._id } },
      {
        $group: {
          _id: '$campaigns.status',
          count: { $sum: 1 }
        }
      }
    ]);

    const statusCounts = { sent: 0, delivered: 0, failed: 0, pending: 0 };
    stats.forEach(s => {
      if (['sent', 'delivered', 'read', 'replied'].includes(s._id)) statusCounts.sent += s.count;
      if (['delivered', 'read', 'replied'].includes(s._id)) statusCounts.delivered += s.count;
      if (s._id === 'failed') statusCounts.failed += s.count;
      if (['draft', 'queued'].includes(s._id)) statusCounts.pending += s.count;
    });

    this.stats = { ...this.stats, ...statusCounts };
    await this.save();
    
    // Update master campaign if exists
    if (this.masterCampaignId) {
      const Campaign = mongoose.model('Campaign');
      const master = await Campaign.findById(this.masterCampaignId);
      if (master) await master.syncMasterStats();
    }
    
    return this.stats;
  }
  
  // If master, aggregate from sub-campaigns
  return this.syncMasterStats();
};

// Sync master campaign stats from all sub-campaigns
campaignSchema.methods.syncMasterStats = async function () {
  if (!this.isMaster) return this.stats;
  
  const Campaign = mongoose.model('Campaign');
  const subCampaigns = await Campaign.find({ masterCampaignId: this._id, isMaster: false }).lean();
  
  const aggregated = {
    total: 0,
    sent: 0,
    delivered: 0,
    failed: 0,
    pending: 0,
    read: 0,
    replied: 0
  };
  
  subCampaigns.forEach(sub => {
    aggregated.total += sub.stats?.total || 0;
    aggregated.sent += sub.stats?.sent || 0;
    aggregated.delivered += sub.stats?.delivered || 0;
    aggregated.failed += sub.stats?.failed || 0;
    aggregated.pending += sub.stats?.pending || 0;
    aggregated.read += sub.stats?.read || 0;
    aggregated.replied += sub.stats?.replied || 0;
  });
  
  this.stats = aggregated;
  
  // Update status based on sub-campaigns
  const allCompleted = subCampaigns.every(s => s.status === 'completed');
  const anyFailed = subCampaigns.some(s => s.status === 'failed');
  
  if (allCompleted) {
    this.status = 'completed';
    this.completedAt = new Date();
  } else if (anyFailed && subCampaigns.every(s => ['completed', 'failed'].includes(s.status))) {
    this.status = 'completed'; // Partial completion
  }
  
  await this.save();
  return this.stats;
};

export default mongoose.model('Campaign', campaignSchema);