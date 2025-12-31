import mongoose from 'mongoose';

const messageLogSchema = new mongoose.Schema(
  {
    // Core References
    messageId: {
      type: String,
      required: true,
      index: true,
    },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // Event Type
    eventType: {
      type: String,
      enum: [
        'capability_check',
        'message_send',
        'webhook_received',
        'status_update',
        'user_interaction',
        'USER_MESSAGE'
      ],
      required: true,
      index: true,
    },

    // Status & Result
    status: {
      type: String,
      enum: ['success', 'failed', 'pending', 'retry'],
      required: true,
      index: true,
    },
    statusCode: Number,

    // RCS Specific Data
    rcsData: {
      capabilityStatus: {
        type: String,
        enum: ['rcs_capable', 'not_capable', 'unknown'],
      },
      capabilityToken: String,
      rcsMessageId: String,
      assistantId: String,
    },

    // Error Information (only when needed)
    error: {
      code: String,
      message: String,
      type: {
        type: String,
        enum: ['network', 'validation', 'rate_limit', 'service', 'unknown'],
      },
    },

    // Timing (optimized)
    timestamp: {
      type: Date,
      default: Date.now,
    },
    responseTimeMs: Number,

    // Webhook Data (when applicable)
    webhookData: {
      eventType: String,
      phoneNumber: String,
      interactionType: String,
      suggestionResponse: mongoose.Schema.Types.Mixed,
    },

    // Cost Tracking
    cost: {
      type: Number,
      default: 0,
    },

    // Retry Information
    retryCount: {
      type: Number,
      default: 0,
    },

    // Minimal metadata
    metadata: {
      requestId: String,
      batchId: String,
      source: {
        type: String,
        enum: ['api', 'webhook', 'system'],
        default: 'api',
      },
    },
  },
  {
    timestamps: false, // Using custom timestamp field
    collection: 'message_logs',
  }
);

// Optimized indexes for high volume
messageLogSchema.index({ userId: 1, timestamp: -1 });
messageLogSchema.index({ messageId: 1, eventType: 1 });
messageLogSchema.index({ campaignId: 1, status: 1 });
messageLogSchema.index({ status: 1, timestamp: -1 });
messageLogSchema.index({ eventType: 1, timestamp: -1 });

// TTL Index - auto-delete after 90 days
messageLogSchema.index(
  { timestamp: 1 },
  { expireAfterSeconds: 7776000 } // 90 days
);

// Static methods for efficient logging
messageLogSchema.statics.logCapabilityCheck = function(data) {
  return this.create({
    messageId: data.messageId,
    userId: data.userId,
    eventType: 'capability_check',
    status: data.isCapable ? 'success' : 'failed',
    statusCode: data.statusCode,
    rcsData: {
      capabilityStatus: data.isCapable ? 'rcs_capable' : 'not_capable',
      capabilityToken: data.token,
    },
    error: data.error ? {
      code: data.errorCode,
      message: data.errorMessage,
      type: data.errorType,
    } : undefined,
    responseTimeMs: data.responseTimeMs,
    metadata: {
      requestId: data.requestId,
      source: 'api',
    },
  });
};

messageLogSchema.statics.logMessageSend = function(data) {
  return this.create({
    messageId: data.messageId,
    campaignId: data.campaignId,
    userId: data.userId,
    eventType: 'message_send',
    status: data.success ? 'success' : 'failed',
    statusCode: data.statusCode,
    rcsData: {
      rcsMessageId: data.rcsMessageId,
      capabilityToken: data.capabilityToken,
      assistantId: data.assistantId,
    },
    error: data.error ? {
      code: data.errorCode,
      message: data.errorMessage,
      type: data.errorType,
    } : undefined,
    cost: data.cost || 1,
    responseTimeMs: data.responseTimeMs,
    retryCount: data.retryCount || 0,
    metadata: {
      requestId: data.requestId,
      batchId: data.batchId,
      source: 'api',
    },
  });
};

messageLogSchema.statics.logWebhookEvent = function(data) {
  return this.create({
    messageId: data.messageId,
    campaignId: data.campaignId,
    userId: data.userId,
    eventType: data.isUserInteraction ? 'user_interaction' : 'status_update',
    status: 'success',
    webhookData: {
      eventType: data.eventType,
      phoneNumber: data.phoneNumber,
      interactionType: data.interactionType,
      suggestionResponse: data.suggestionResponse,
    },
    metadata: {
      source: 'webhook',
    },
  });
};

// Bulk insert for high performance
messageLogSchema.statics.bulkLog = function(logs) {
  return this.insertMany(logs, { ordered: false });
};

// Analytics methods
messageLogSchema.statics.getCampaignAnalytics = function(campaignId, timeframe = 24) {
  const timeAgo = new Date(Date.now() - timeframe * 60 * 60 * 1000);
  
  return this.aggregate([
    {
      $match: {
        campaignId: new mongoose.Types.ObjectId(campaignId),
        timestamp: { $gte: timeAgo },
      },
    },
    {
      $group: {
        _id: {
          eventType: '$eventType',
          status: '$status',
        },
        count: { $sum: 1 },
        totalCost: { $sum: '$cost' },
        avgResponseTime: { $avg: '$responseTimeMs' },
      },
    },
  ]);
};

messageLogSchema.statics.getUserStats = function(userId, timeframe = 24) {
  const timeAgo = new Date(Date.now() - timeframe * 60 * 60 * 1000);
  
  return this.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(userId),
        timestamp: { $gte: timeAgo },
      },
    },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalCost: { $sum: '$cost' },
      },
    },
  ]);
};

export default mongoose.model('MessageLog', messageLogSchema);