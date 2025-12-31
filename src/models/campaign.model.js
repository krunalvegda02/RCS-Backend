
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

// Methods
campaignSchema.methods.updateStats = async function () {
  // Count recipients by their current status
  const statusCounts = {
    pending: 0,
    queued: 0,
    processing: 0,
    sent: 0,
    delivered: 0,
    read: 0,
    replied: 0,
    failed: 0,
    bounced: 0
  };

  this.recipients.forEach(r => {
    if (statusCounts.hasOwnProperty(r.status)) {
      statusCounts[r.status]++;
    }
  });

  // Calculate cumulative stats (read includes delivered and sent, etc.)
  const stats = {
    total: this.recipients.length,
    pending: statusCounts.pending,
    queued: statusCounts.queued,
    processing: statusCounts.processing,
    // Sent = all messages that reached sent status or beyond
    sent: statusCounts.sent + statusCounts.delivered + statusCounts.read + statusCounts.replied,
    // Delivered = all messages that reached delivered status or beyond
    delivered: statusCounts.delivered + statusCounts.read + statusCounts.replied,
    // Read = all messages that reached read status or beyond
    read: statusCounts.read + statusCounts.replied,
    // Replied = only messages with replied status
    replied: statusCounts.replied,
    failed: statusCounts.failed,
    bounced: statusCounts.bounced,
    rcsCapable: this.recipients.filter(r => r.isRcsCapable === true).length,
  };

  stats.successRate = stats.total > 0 ? (stats.delivered / stats.total) * 100 : 0;
  stats.failureRate = stats.total > 0 ? ((stats.failed + stats.bounced) / stats.total) * 100 : 0;
  stats.lastUpdatedAt = new Date();

  this.stats = stats;
  await this.save();
};

campaignSchema.methods.getPendingRecipients = function (limit = 100) {
  return this.recipients.filter(r => r.status === 'pending').slice(0, limit);
};

campaignSchema.methods.markRecipientAsSent = async function (phoneNumber, messageId) {
  const recipient = this.recipients.find(r => r.phoneNumber === phoneNumber);
  if (recipient) {
    recipient.status = 'sent';
    recipient.messageId = messageId;
    recipient.sentAt = new Date();
    await this.save();
  }
};

campaignSchema.methods.markRecipientAsFailed = async function (phoneNumber, reason) {
  const recipient = this.recipients.find(r => r.phoneNumber === phoneNumber);
  if (recipient) {
    recipient.status = 'failed';
    recipient.failureReason = reason;
    await this.save();
  }
};

campaignSchema.methods.markRecipientAsProcessing = async function (phoneNumber) {
  const recipient = this.recipients.find(r => r.phoneNumber === phoneNumber);
  if (recipient) {
    recipient.status = 'processing';
    await this.save();
  }
};

export default mongoose.model('Campaign', campaignSchema);