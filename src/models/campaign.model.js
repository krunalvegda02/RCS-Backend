
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

// Complete campaign and settle wallet
campaignSchema.methods.completeCampaign = async function() {
  // Prevent double completion
  if (this.status === 'completed' && this.blockedAmount === 0) {
    console.log(`Campaign ${this._id} already completed properly`);
    return;
  }
  
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const User = mongoose.model('User');
    const Campaign = mongoose.model('Campaign');
    
    // Get fresh campaign data within transaction
    const campaign = await Campaign.findById(this._id).session(session);
    if (!campaign) {
      throw new Error('Campaign not found');
    }
    
    const user = await User.findById(campaign.userId).session(session);
    if (!user) {
      throw new Error('User not found');
    }

    if (!ContactCampaignMessage) {
      ContactCampaignMessage = mongoose.model('ContactCampaignMessage');
    }
    
    const stats = await ContactCampaignMessage.aggregate([
      { $match: { userId: campaign.userId } },
      { $unwind: '$campaigns' },
      { $match: { 'campaigns.campaignId': campaign._id } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          delivered: {
            $sum: {
              $cond: [{ $in: ['$campaigns.status', ['delivered', 'read', 'replied']] }, 1, 0]
            }
          },
          failed: {
            $sum: {
              $cond: [{ $in: ['$campaigns.status', ['failed', 'bounced']] }, 1, 0]
            }
          },
          expired: {
            $sum: {
              $cond: [{ $in: ['$campaigns.status', ['pending', 'queued', 'sent']] }, 1, 0]
            }
          }
        }
      }
    ]).session(session);

    const deliveryStats = stats[0] || { total: 0, delivered: 0, failed: 0, expired: 0 };
    
    // Calculate actual cost (only delivered messages)
    const actualCost = deliveryStats.delivered * 1;
    const blockedAmount = campaign.blockedAmount || campaign.estimatedCost || deliveryStats.total;
    const refundAmount = Math.max(0, blockedAmount - actualCost);

    console.log(`[CompleteCampaign] ${campaign._id}: Blocked=₹${blockedAmount}, Actual=₹${actualCost}, Refund=₹${refundAmount}`);

    // Wallet settlement FIRST (before updating campaign)
    const walletUpdate = {
      $inc: {
        'wallet.balance': -actualCost,
        'wallet.blockedBalance': -blockedAmount
      },
      $set: {
        'wallet.lastUpdated': new Date()
      },
      $push: {
        'wallet.transactions': {
          type: 'debit',
          amount: actualCost,
          balanceAfter: user.wallet.balance - actualCost,
          description: `Campaign "${campaign.name}" completed. Charged ₹${actualCost} for ${deliveryStats.delivered} delivered. ${deliveryStats.failed} failed + ${deliveryStats.expired} expired not charged.`,
          createdAt: new Date()
        }
      }
    };

    await User.findByIdAndUpdate(campaign.userId, walletUpdate, { session });

    // Update campaign AFTER wallet is updated - CRITICAL: Use findByIdAndUpdate
    await Campaign.findByIdAndUpdate(
      campaign._id,
      {
        $set: {
          actualCost,
          refundedAmount: refundAmount,
          blockedAmount: 0,
          status: 'completed',
          completedAt: new Date(),
          'stats.total': deliveryStats.total,
          'stats.sent': deliveryStats.delivered + deliveryStats.failed + deliveryStats.expired,
          'stats.delivered': deliveryStats.delivered,
          'stats.failed': deliveryStats.failed,
          'stats.read': 0,
          'stats.replied': 0,
          'stats.bounced': 0
        }
      },
      { session }
    );

    await session.commitTransaction();
    
    console.log(`✅ Campaign ${campaign._id} completed successfully`);
    console.log(`   Delivered: ${deliveryStats.delivered}, Failed: ${deliveryStats.failed}, Expired: ${deliveryStats.expired}`);
    
    // Update local instance
    this.actualCost = actualCost;
    this.refundedAmount = refundAmount;
    this.blockedAmount = 0;
    this.status = 'completed';
    this.completedAt = new Date();
    
    return {
      actualCost,
      refundAmount,
      delivered: deliveryStats.delivered,
      failed: deliveryStats.failed,
      expired: deliveryStats.expired
    };
  } catch (error) {
    await session.abortTransaction();
    console.error(`❌ Campaign completion failed for ${this._id}:`, error.message);
    throw error;
  } finally {
    session.endSession();
  }
};

export default mongoose.model('Campaign', campaignSchema);