
import mongoose from 'mongoose';

// Import ContactCampaignMessage for stats aggregation
let ContactCampaignMessage;
try {
  ContactCampaignMessage = mongoose.model('ContactCampaignMessage');
} catch {
  // Will be set when the model is registered
}

const campaignSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Campaign name is required'],
      trim: true,
      maxlength: 100,
    },
    botId: {
      type: String,
      required: true,
      index: true
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
campaignSchema.index({ botId: 1, status: 1 });

// Sync stats from ContactCampaignMessage
campaignSchema.methods.syncStats = async function () {
  if (!ContactCampaignMessage) {
    ContactCampaignMessage = mongoose.model('ContactCampaignMessage');
  }
  
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
  return this.stats;
};

// Find available bot (bot1-bot50)
campaignSchema.statics.findAvailableBot = async function() {
  for (let i = 1; i <= 50; i++) {
    const botId = `bot${i}`;
    const runningCampaign = await this.findOne({ 
      botId, 
      status: { $in: ['pending', 'processing', 'running'] } 
    });
    
    if (!runningCampaign) {
      return botId;
    }
  }
  throw new Error('All bots are currently assigned to running campaigns');
};

export default mongoose.model('Campaign', campaignSchema);