
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
            enum: ['pending', 'processing', 'sent', 'failed', 'bounced'],
            default: 'pending',
          },
          isRcsCapable: {
            type: Boolean,
            default: false, // Track RCS capability for billing
          },
          messageId: String,
          sentAt: Date,
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
    scheduledAt: Date,
    startedAt: Date,
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
      failed: {
        type: Number,
        default: 0,
      },
      pending: {
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
  const stats = {
    total: this.recipients.length,
    sent: this.recipients.filter(r => r.status === 'sent').length,
    failed: this.recipients.filter(r => r.status === 'failed').length,
    pending: this.recipients.filter(r => r.status === 'pending').length,
    processing: this.recipients.filter(r => r.status === 'processing').length,
  };

  stats.successRate = stats.total > 0 ? (stats.sent / stats.total) * 100 : 0;
  stats.failureRate = stats.total > 0 ? (stats.failed / stats.total) * 100 : 0;
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