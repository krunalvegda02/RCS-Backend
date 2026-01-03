
import mongoose from 'mongoose';

const campaignSchema = new mongoose.Schema(
  {
    // Basic Info
    name: {
      type: String,
      required: [true, 'Campaign name is required'],
      trim: true,
      maxlength: 100,
    },
    description: String,

    // Campaign Configuration
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

    // Recipients & Content
    recipients: {
      type: [
        {
          phoneNumber: {
            type: String,
            required: true,
            match: /^[0-9]{10,15}$/,
          },
          variables: mongoose.Schema.Types.Mixed, // For dynamic content
          status: {
            type: String,
            enum: ['pending', 'queued', 'processing', 'sent', 'delivered', 'read', 'replied', 'failed', 'bounced'],
            default: 'pending',
          },
          messageId: String,
          sentAt: Date,
          deliveredAt: Date,
          readAt: Date,
          failedAt: Date,
          lastInteractionAt: Date,
          errorMessage: String,
          failureReason: String,
        },
      ],
      default: [],
    },

    // Campaign Status
    status: {
      type: String,
      enum: ['draft', 'scheduled', 'running', 'paused', 'completed', 'failed'],
      default: 'draft',
      index: true,
    },

    // Timing
    // scheduledAt: Date,
    // startedAt: Date,
    completedAt: Date,
    pausedAt: Date,

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
      pending: {
        type: Number,
        default: 0,
      },
      queued: {
        type: Number,
        default: 0,
      },
      processing: {
        type: Number,
        default: 0,
      },
      rcsCapable: {
        type: Number,
        default: 0, // Count of RCS capable recipients
      },
      successRate: {
        type: Number,
        default: 0,
      },
      failureRate: {
        type: Number,
        default: 0,
      },
      lastUpdatedAt: Date,
    },

    // Batch Processing Config
    batchSize: {
      type: Number,
      default: 100,
      min: 1,
      max: 1000,
    },
    delayBetweenBatches: {
      type: Number,
      default: 1000, // milliseconds
    },
    maxRetries: {
      type: Number,
      default: 3,
    },

    // Queue Information
    queueStatus: {
      currentBatch: Number,
      totalBatches: Number,
      processedBatches: Number,
      failedBatches: Number,
    },

    // Audit
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },

    // Budget/Rate Limit
    estimatedCost: {
      type: Number,
      default: 0, // Based on RCS capable recipients only
    },
    actualCost: {
      type: Number,
      default: 0, // Actual amount charged
    },
    blockedAmount: {
      type: Number,
      default: 0, // Amount blocked from user wallet
    },
    rateLimit: {
      messagesPerSecond: {
        type: Number,
        default: 10,
      },
      dailyLimit: {
        type: Number,
        default: 100000,
      },
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
campaignSchema.index({ 'recipients.status': 1 });

// Pre-save middleware to update user stats when campaign completes
campaignSchema.pre('save', async function (next) {
  // Check if status is being changed to 'completed' or 'failed'
  if (this.isModified('status') && ['completed', 'failed'].includes(this.status) && this.isNew === false) {
    try {
      const User = mongoose.model('User');
      const user = await User.findById(this.userId);
      
      if (user) {
        await user.recalculateStatsOnCampaignCompletion(this._id);
        console.log(`[Campaign] User stats updated for ${this.status} campaign ${this._id}`);
      }
    } catch (error) {
      console.error('Error updating user stats on campaign completion:', error);
      // Don't fail the campaign save if user stats update fails
    }
  }
  next();
});

// Methods
campaignSchema.methods.updateStats = async function () {
  // Get actual message counts from Message collection for accurate stats
  const Message = mongoose.model('Message');
  const messageCounts = await Message.aggregate([
    { $match: { campaignId: this._id } },
    { $group: { _id: '$status', count: { $sum: 1 } } }
  ]);
  
  // Initialize counts
  const statusCounts = {
    draft: 0,
    queued: 0,
    sent: 0,
    delivered: 0,
    read: 0,
    replied: 0,
    failed: 0,
    bounced: 0
  };
  
  // Populate counts from Message collection (source of truth)
  messageCounts.forEach(item => {
    if (statusCounts.hasOwnProperty(item._id)) {
      statusCounts[item._id] = item.count;
    }
  });
  
  // Calculate total from actual messages
  const totalMessages = Object.values(statusCounts).reduce((sum, count) => sum + count, 0);
  
  // Update stats based on actual message status
  const stats = {
    total: this.recipients.length, // Total recipients
    pending: this.recipients.length - totalMessages, // Recipients without messages yet
    processing: statusCounts.draft + statusCounts.queued, // Messages being processed
    sent: statusCounts.sent + statusCounts.delivered + statusCounts.read + statusCounts.replied,
    delivered: statusCounts.delivered + statusCounts.read + statusCounts.replied,
    read: statusCounts.read + statusCounts.replied,
    replied: statusCounts.replied,
    failed: statusCounts.failed,
    bounced: statusCounts.bounced,
    queued: statusCounts.queued,
    rcsCapable: this.recipients.filter(r => r.isRcsCapable === true).length,
  };

  stats.successRate = stats.total > 0 ? (stats.delivered / stats.total) * 100 : 0;
  stats.failureRate = stats.total > 0 ? ((stats.failed + stats.bounced) / stats.total) * 100 : 0;
  stats.lastUpdatedAt = new Date();

  this.stats = stats;
  
  // Auto-update campaign status based on message processing completion
  const totalProcessed = stats.sent + stats.failed + stats.bounced;
  const hasUnprocessedMessages = stats.pending > 0 || stats.processing > 0;
  
  const wasRunning = this.status === 'running';
  if (wasRunning && !hasUnprocessedMessages && totalProcessed >= this.recipients.length) {
    this.status = 'completed';
    this.completedAt = new Date();
    console.log(`Campaign ${this._id} marked as completed - Total: ${this.recipients.length}, Processed: ${totalProcessed}`);
    console.log(`[Campaign] Will trigger pre-save hook to unblock remaining balance`);
    
    // Emit socket event for campaign completion
    if (global.io) {
      global.io.emitCampaignUpdate(this._id, {
        status: 'completed',
        completedAt: this.completedAt,
        stats: stats
      });
    }
  }
  
  await this.save(); // Use save() to trigger pre-save hooks
};

campaignSchema.methods.getPendingRecipients = function (limit = 100) {
  return this.recipients.filter(r => r.status === 'pending').slice(0, limit);
};

campaignSchema.methods.updateRecipientStatus = async function (phoneNumber, status, messageId = null) {
  const recipient = this.recipients.find(r => r.phoneNumber === phoneNumber);
  if (recipient) {
    recipient.status = status;
    if (messageId) recipient.messageId = messageId;
    
    const now = new Date();
    switch (status) {
      case 'sent': recipient.sentAt = now; break;
      case 'delivered': recipient.deliveredAt = now; break;
      case 'read': recipient.readAt = now; break;
      case 'failed': recipient.failedAt = now; break;
    }
    
    await this.save();
  }
};

export default mongoose.model('Campaign', campaignSchema);