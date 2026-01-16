
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
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    // Get user
    const User = mongoose.model('User');
    const user = await User.findById(this.userId).session(session);
    
    if (!user) {
      throw new Error('User not found');
    }

    // Get actual delivery stats from ContactCampaignMessage
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
          },
          totalCost: { $sum: { $ifNull: ['$campaigns.cost', 0] } }
        }
      }
    ]).session(session);

    const deliveryStats = stats[0] || { total: 0, delivered: 0, failed: 0, expired: 0, totalCost: 0 };
    
    // Calculate costs
    // - Charge only for delivered messages
    // - Refund failed + expired messages
    const actualCost = deliveryStats.delivered * 1; // ₹1 per delivered
    const blockedAmount = this.blockedAmount || 0;
    const refundAmount = Math.max(0, blockedAmount - actualCost);

    // Update campaign
    this.actualCost = actualCost;
    this.refundedAmount = refundAmount;
    this.status = 'completed';
    this.completedAt = new Date();
    this.stats = {
      total: deliveryStats.total,
      sent: deliveryStats.delivered + deliveryStats.failed + deliveryStats.expired,
      delivered: deliveryStats.delivered,
      failed: deliveryStats.failed,
      read: 0,
      replied: 0,
      bounced: 0
    };
    await this.save({ session });

    // Settle wallet atomically
    const walletUpdate = {
      $inc: {
        'wallet.balance': refundAmount, // Add refund back to balance
        'wallet.blockedBalance': -blockedAmount // Remove from blocked
      },
      $set: {
        'wallet.lastUpdated': new Date()
      },
      $push: {
        'wallet.transactions': {
          type: 'credit',
          amount: refundAmount,
          balanceAfter: user.wallet.balance + refundAmount,
          description: `Campaign "${this.name}" completed. Charged ₹${actualCost} for ${deliveryStats.delivered} delivered. Refunded ₹${refundAmount} for ${deliveryStats.failed} failed + ${deliveryStats.expired} expired.`,
          createdAt: new Date()
        }
      }
    };

    await User.findByIdAndUpdate(this.userId, walletUpdate, { session });

    await session.commitTransaction();
    
    console.log(`✅ Campaign ${this._id} completed:`);
    console.log(`   Blocked: ₹${blockedAmount}, Actual: ₹${actualCost}, Refund: ₹${refundAmount}`);
    console.log(`   Delivered: ${deliveryStats.delivered}, Failed: ${deliveryStats.failed}, Expired: ${deliveryStats.expired}`);
    
    return {
      actualCost,
      refundAmount,
      delivered: deliveryStats.delivered,
      failed: deliveryStats.failed,
      expired: deliveryStats.expired
    };
  } catch (error) {
    await session.abortTransaction();
    console.error('Campaign completion failed:', error);
    throw error;
  } finally {
    session.endSession();
  }
};

export default mongoose.model('Campaign', campaignSchema);