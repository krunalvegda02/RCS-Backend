
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
      enum: ['draft', 'pending', 'processing', 'running', 'completed', 'failed', 'settled'],
      default: 'draft',
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
    blockedAmount: {
      type: Number,
      default: 0,
    },
    refundedAmount: {
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











// Sync stats from ContactCampaignMessage - AUTOMATIC
campaignSchema.methods.syncStats = async function () {
  if (!ContactCampaignMessage) {
    ContactCampaignMessage = mongoose.model('ContactCampaignMessage');
  }

  const stats = await ContactCampaignMessage.aggregate([
    { $match: { userId: this.userId } },
    { $unwind: '$campaigns' },
    { $match: { 'campaigns.campaignId': this._id } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        sent: { $sum: { $cond: [{ $eq: ['$campaigns.status', 'sent'] }, 1, 0] } },
        delivered: { $sum: { $cond: [{ $eq: ['$campaigns.status', 'delivered'] }, 1, 0] } },
        read: { $sum: { $cond: [{ $eq: ['$campaigns.status', 'read'] }, 1, 0] } },
        replied: { $sum: { $cond: [{ $eq: ['$campaigns.status', 'replied'] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $in: ['$campaigns.status', ['failed', 'bounced', 'expired']] }, 1, 0] } }
      }
    }
  ]);

  const newStats = stats[0] || { total: 0, sent: 0, delivered: 0, read: 0, replied: 0, failed: 0 };
  
  this.stats = {
    total: newStats.total,
    sent: newStats.sent,
    delivered: newStats.delivered,
    read: newStats.read,
    replied: newStats.replied,
    failed: newStats.failed,
    bounced: 0
  };
  
  await this.save();
  return this.stats;
};












// Find available bot (bot1-bot50)
// Find available bot (bot1-bot50) with Load Balancing
campaignSchema.statics.findAvailableBot = async function () {
  const TOTAL_BOTS = 2;
  const botLoads = [];

  // 1. Check load for all bots
  for (let i = 1; i <= TOTAL_BOTS; i++) {
    const botId = `bot${i}`;
    const activeCampaignsCount = await this.countDocuments({
      botId,
      status: { $in: ['pending', 'processing', 'running'] }
    });

    // If completely free, return immediately
    if (activeCampaignsCount === 0) {
      return botId;
    }

    botLoads.push({ botId, count: activeCampaignsCount });
  }

  // 2. If all busy, find the one with MINIMUM load
  botLoads.sort((a, b) => a.count - b.count);
  const bestBot = botLoads[0];

  console.log(`[BotAssignment] All bots busy. Assigning to ${bestBot.botId} (Queue size: ${bestBot.count})`);
  return bestBot.botId;
};












// Settle campaign wallet - called by expirePendingMessages.js
campaignSchema.methods.completeCampaign = async function () {
  console.log(`[SettleCampaign] Starting for campaign ${this._id}`);

  try {
    const User = mongoose.model('User');
    const Campaign = mongoose.model('Campaign');

    // Skip if already settled
    if (this.status === 'settled') {
      console.log(`[SettleCampaign] Campaign ${this._id} already settled, skipping`);
      return;
    }

    if (!ContactCampaignMessage) {
      ContactCampaignMessage = mongoose.model('ContactCampaignMessage');
    }

    // 1. Aggregate message stats
    const stats = await ContactCampaignMessage.aggregate([
      { $match: { userId: this.userId } },
      { $unwind: '$campaigns' },
      { $match: { 'campaigns.campaignId': this._id } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          sent: { $sum: { $cond: [{ $eq: ['$campaigns.status', 'sent'] }, 1, 0] } },
          delivered: { $sum: { $cond: [{ $eq: ['$campaigns.status', 'delivered'] }, 1, 0] } },
          read: { $sum: { $cond: [{ $eq: ['$campaigns.status', 'read'] }, 1, 0] } },
          replied: { $sum: { $cond: [{ $eq: ['$campaigns.status', 'replied'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $in: ['$campaigns.status', ['failed', 'bounced', 'expired']] }, 1, 0] } },
          deliveredTotal: {
            $sum: { $cond: [{ $in: ['$campaigns.status', ['delivered', 'read', 'replied']] }, 1, 0] }
          }
        }
      }
    ], { maxTimeMS: 15000, allowDiskUse: true });

    const deliveryStats = stats[0] || { total: 0, sent: 0, delivered: 0, read: 0, replied: 0, failed: 0, deliveredTotal: 0 };
    console.log(`[SettleCampaign] Stats: total=${deliveryStats.total}, delivered=${deliveryStats.deliveredTotal}, failed=${deliveryStats.failed}`);

    // 2. Calculate costs
    const blockedAmount = this.blockedAmount || this.estimatedCost || deliveryStats.total;
    const actualCost = deliveryStats.deliveredTotal * 1; // ₹1 per delivered
    const refundAmount = Math.max(0, blockedAmount - actualCost);

    console.log(`[SettleCampaign] Blocked=₹${blockedAmount}, Charge=₹${actualCost}, Refund=₹${refundAmount}`);

    // 3. Update wallet (release blocked, deduct actual cost)
    if (blockedAmount > 0) {
      await User.findByIdAndUpdate(this.userId, {
        $inc: {
          'wallet.balance': -actualCost,
          'wallet.blockedBalance': -blockedAmount
        },
        $set: { 'wallet.lastUpdated': new Date() }
      });
      console.log(`[SettleCampaign] Wallet updated`);
    }

    // 4. Update campaign to 'settled' - PRESERVE ALL STATS
    await Campaign.findByIdAndUpdate(this._id, {
      $set: {
        status: 'settled',
        actualCost,
        refundedAmount: refundAmount,
        blockedAmount: 0,
        completedAt: new Date(),
        'stats.total': deliveryStats.total,
        'stats.sent': deliveryStats.sent,
        'stats.delivered': deliveryStats.delivered,
        'stats.read': deliveryStats.read,
        'stats.replied': deliveryStats.replied,
        'stats.failed': deliveryStats.failed
      }
    });

    // Update local instance
    this.status = 'settled';
    this.actualCost = actualCost;
    this.refundedAmount = refundAmount;
    this.blockedAmount = 0;
    this.stats.total = deliveryStats.total;
    this.stats.sent = deliveryStats.sent;
    this.stats.delivered = deliveryStats.delivered;
    this.stats.read = deliveryStats.read;
    this.stats.replied = deliveryStats.replied;
    this.stats.failed = deliveryStats.failed;

    console.log(`[SettleCampaign] ✅ Campaign ${this._id} settled successfully`);

    return { actualCost, refundAmount, delivered: deliveryStats.deliveredTotal, failed: deliveryStats.failed };
  } catch (error) {
    console.error(`[SettleCampaign] ❌ Error:`, error.message);
    throw error;
  }
};









export default mongoose.model('Campaign', campaignSchema);