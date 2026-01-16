
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
  console.log(`\n========================================`);
  console.log(`[CompleteCampaign] START for campaign ${this._id}`);
  console.log(`[CompleteCampaign] Current status: ${this.status}, blockedAmount: ${this.blockedAmount}`);
  
  const session = await mongoose.startSession();
  session.startTransaction();
  console.log(`[CompleteCampaign] Transaction started`);
  
  try {
    const User = mongoose.model('User');
    const Campaign = mongoose.model('Campaign');
    
    // Get fresh campaign data within transaction
    console.log(`[CompleteCampaign] Fetching fresh campaign data...`);
    const campaign = await Campaign.findById(this._id).session(session);
    if (!campaign) {
      throw new Error('Campaign not found');
    }
    console.log(`[CompleteCampaign] Fresh data: status=${campaign.status}, blockedAmount=${campaign.blockedAmount}`);
    
    // If already completed with blockedAmount = 0, skip
    if (campaign.status === 'completed' && campaign.blockedAmount === 0) {
      await session.abortTransaction();
      console.log(`[CompleteCampaign] ✅ Already completed properly, skipping`);
      console.log(`========================================\n`);
      return;
    }
    
    console.log(`[CompleteCampaign] Fetching user data...`);
    const user = await User.findById(campaign.userId).session(session);
    if (!user) {
      throw new Error('User not found');
    }
    console.log(`[CompleteCampaign] User wallet: balance=${user.wallet.balance}, blocked=${user.wallet.blockedBalance}`);

    if (!ContactCampaignMessage) {
      ContactCampaignMessage = mongoose.model('ContactCampaignMessage');
    }
    
    console.log(`[CompleteCampaign] Aggregating message stats...`);
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
    console.log(`[CompleteCampaign] Message stats:`, deliveryStats);
    
    // Calculate actual cost (only delivered messages)
    const actualCost = deliveryStats.delivered * 1;
    const blockedAmount = campaign.blockedAmount || campaign.estimatedCost || deliveryStats.total;
    const refundAmount = Math.max(0, blockedAmount - actualCost);

    console.log(`[CompleteCampaign] Calculations: Blocked=₹${blockedAmount}, Actual=₹${actualCost}, Refund=₹${refundAmount}`);

    // Only adjust wallet if there's a blocked amount to unblock
    if (blockedAmount > 0) {
      console.log(`[CompleteCampaign] Updating wallet...`);
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

      const walletResult = await User.findByIdAndUpdate(campaign.userId, walletUpdate, { session, new: true });
      console.log(`[CompleteCampaign] Wallet updated: balance=${walletResult.wallet.balance}, blocked=${walletResult.wallet.blockedBalance}`);
    } else {
      console.log(`[CompleteCampaign] No blocked amount to unblock, skipping wallet update`);
    }

    // CRITICAL: Update campaign with explicit $set to ensure blockedAmount becomes 0
    console.log(`[CompleteCampaign] Updating campaign document...`);
    const updateResult = await Campaign.updateOne(
      { _id: campaign._id },
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

    console.log(`[CompleteCampaign] Campaign update result: matched=${updateResult.matchedCount}, modified=${updateResult.modifiedCount}`);
    
    if (updateResult.matchedCount === 0) {
      throw new Error('Campaign not found during update');
    }
    if (updateResult.modifiedCount === 0) {
      console.warn(`[CompleteCampaign] ⚠️  Campaign matched but not modified - may already have these values`);
    }

    console.log(`[CompleteCampaign] Committing transaction...`);
    await session.commitTransaction();
    console.log(`[CompleteCampaign] Transaction committed successfully`);
    
    // Verify the update
    const verifyResult = await Campaign.findById(campaign._id).select('blockedAmount status');
    console.log(`[CompleteCampaign] Verification: blockedAmount=${verifyResult.blockedAmount}, status=${verifyResult.status}`);
    
    console.log(`✅ Campaign ${campaign._id} completed successfully`);
    console.log(`   Delivered: ${deliveryStats.delivered}, Failed: ${deliveryStats.failed}, Expired: ${deliveryStats.expired}`);
    console.log(`========================================\n`);
    
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
    console.error(`[CompleteCampaign] ❌ ERROR occurred:`, error.message);
    console.error(`[CompleteCampaign] Stack trace:`, error.stack);
    console.log(`[CompleteCampaign] Aborting transaction...`);
    await session.abortTransaction();
    console.log(`[CompleteCampaign] Transaction aborted`);
    console.log(`========================================\n`);
    throw error;
  } finally {
    session.endSession();
  }
};

export default mongoose.model('Campaign', campaignSchema);