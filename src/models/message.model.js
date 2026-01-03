
import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema(
  {
    // Message Identification
    messageId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      index: true,
    },

    // Sender & Recipient
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    recipientPhoneNumber: {
      type: String,
      required: true,
      match: /^[0-9]{10,15}$/,
      index: true,
    },

    // Template Information
    templateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Template',
      required: true,
    },
    templateType: {
      type: String,
      enum: ['richCard', 'carousel', 'textWithAction', 'plainText'],
      required: true,
    },

    // Message Content
    content: mongoose.Schema.Types.Mixed,
    variables: mongoose.Schema.Types.Mixed,

    // Jio RCS Specific
    assistantId: String,
    rcsMessageId: String,
    jioMessageId: String, // Store Jio's webhook messageId
    externalMessageId: String, // Generic external ID field

    // Status Tracking
    status: {
      type: String,
      enum: [
        'draft',
        'queued',
        'processing',
        'sent',
        'delivered',
        'failed',
        'bounced',
        'read',
        'replied',
      ],
      default: 'draft',
      index: true,
    },

   
    queuedAt: Date,
    sentAt: Date,
    deliveredAt: Date,
    readAt: Date,
    failedAt: Date,
    lastWebhookAt: Date,

    // Error Handling
    errorCode: String,
    errorMessage: String,
    retryCount: {
      type: Number,
      default: 0,
    },
    nextRetryAt: Date,
    
    // Engagement Tracking
    clickedAt: Date,
    clickedAction: String,
    clickedUri: String,
    userText: String,
    suggestionResponse: mongoose.Schema.Types.Mixed,
    userClickCount: {
      type: Number,
      default: 0,
    },
    userReplyCount: {
      type: Number,
      default: 0,
    },
    lastInteractionAt: Date,

    // Metadata
    deviceType: String,
    ipAddress: String,
    userAgent: String,

    // Cost
    cost: Number,

    // Audit
    notes: String,
  },
  {
    timestamps: true,
    collection: 'messages',
  }
);

// Indexes for high-volume queries
messageSchema.index({ userId: 1, createdAt: -1 });
messageSchema.index({ status: 1, createdAt: -1 });
messageSchema.index({ campaignId: 1, status: 1 });
messageSchema.index({ recipientPhoneNumber: 1, sentAt: -1 });
messageSchema.index({ userId: 1, status: 1, createdAt: -1 });
// Webhook lookup indexes
messageSchema.index({ jioMessageId: 1 });
messageSchema.index({ externalMessageId: 1 });
messageSchema.index({ rcsMessageId: 1 });

// TTL Index for automatic cleanup of old messages (optional)
messageSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 7776000 } // 90 days
);

// Virtual for quick status check
messageSchema.virtual('isSent').get(function () {
  return ['sent', 'delivered', 'read', 'replied'].includes(this.status);
});

messageSchema.virtual('isFailed').get(function () {
  return ['failed', 'bounced'].includes(this.status);
});

// Methods
messageSchema.methods.markAsSent = async function (rcsMessageId) {
  // This method is now only called by webhook, not by sendMessage
  this.status = 'sent';
  this.sentAt = new Date();
  if (rcsMessageId) {
    this.rcsMessageId = rcsMessageId;
  }
  await this.save();
};

messageSchema.methods.markAsDelivered = async function () {
  this.status = 'delivered';
  this.deliveredAt = new Date();
  await this.save();
};

messageSchema.methods.markAsRead = async function () {
  this.status = 'read';
  this.readAt = new Date();
  await this.save();
};

messageSchema.methods.markAsFailed = async function (errorCode, errorMessage) {
  this.status = 'failed';
  this.failedAt = new Date();
  this.errorCode = errorCode;
  this.errorMessage = errorMessage;
  await this.save();
};

messageSchema.methods.scheduleRetry = async function (delayMs = 60000) {
  this.retryCount += 1;
  this.nextRetryAt = new Date(Date.now() + delayMs);
  await this.save();
};

messageSchema.methods.recordClick = async function (action, uri) {
  this.status = 'replied';
  this.clickedAt = new Date();
  this.clickedAction = action;
  this.clickedUri = uri;
  await this.save();
};

// Statics
messageSchema.statics.findByMessageId = function (messageId) {
  return this.findOne({ messageId });
};

messageSchema.statics.findPendingMessages = function (limit = 1000) {
  return this.find({
    status: { $in: ['queued', 'processing'] },
    $or: [
      { nextRetryAt: { $lte: new Date() } },
      { nextRetryAt: { $exists: false } },
    ],
  })
    .limit(limit)
    .sort({ createdAt: 1 });
};

messageSchema.statics.getDailyStats = async function (userId, date) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  return this.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(userId),
        createdAt: { $gte: startOfDay, $lte: endOfDay },
      },
    },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
      },
    },
  ]);
};

// Post-save middleware to update campaign stats when message status changes
messageSchema.post('save', async function(doc, next) {
  try {
    if (doc.campaignId && doc.isModified('status')) {
      const Campaign = mongoose.model('Campaign');
      const campaign = await Campaign.findById(doc.campaignId);
      if (campaign) {
        await campaign.updateStats();
      }
    }
  } catch (error) {
    console.error('Error updating campaign stats:', error);
  }
  next();
});

// Post-update middleware for findOneAndUpdate operations
messageSchema.post('findOneAndUpdate', async function(doc, next) {
  try {
    if (doc && doc.campaignId) {
      const Campaign = mongoose.model('Campaign');
      const campaign = await Campaign.findById(doc.campaignId);
      if (campaign) {
        await campaign.updateStats();
      }
    }
  } catch (error) {
    console.error('Error updating campaign stats:', error);
  }
  next();
});

export default mongoose.model('Message', messageSchema);