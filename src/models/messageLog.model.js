import mongoose from 'mongoose';

const messageLogSchema = new mongoose.Schema(
  {
    // Core References
    messageId: {
      type: String,
      required: true,
      index: true,
    },
    // campaignId: {
    //   type: mongoose.Schema.Types.ObjectId,
    //   ref: 'Campaign',
    //   index: true,
    // },
    // userId: {
    //   type: mongoose.Schema.Types.ObjectId,
    //   ref: 'User',
    //   required: true,
    //   index: true,
    // },

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
      rawPayload: mongoose.Schema.Types.Mixed,
    },

    // Processing Status
    processed: {
      type: Boolean,
      default: false,
      index: true,
    },
    processedAt: Date,

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
    timestamps: false,
    collection: 'message_logs',
  }
);

// Optimized indexes for high volume
messageLogSchema.index({ processed: 1, _id: 1 });
messageLogSchema.index({ eventType: 1, timestamp: -1 });
messageLogSchema.index({ status: 1, timestamp: -1 });

// 🔥 BUG FIX: More lenient unique index to handle webhook retries
// Use messageId + timestamp for uniqueness instead of messageId + eventType
messageLogSchema.index(
  { messageId: 1, timestamp: 1 },
  { unique: true, sparse: true }
);

// TTL Index - auto-delete after 3 days
messageLogSchema.index(
  { timestamp: 1 },
  { expireAfterSeconds: 259200 } // 3 days
);



// Get unprocessed webhook logs for batch processing
messageLogSchema.statics.getUnprocessedLogs = function (limit = 1000) {
  return this.find({
    processed: false,
    eventType: { $in: ['status_update', 'user_interaction'] }
  })
    .sort({ timestamp: 1 })
    .limit(limit)
    .lean();
};



// Mark logs as processed
messageLogSchema.statics.markAsProcessed = function (logIds) {
  return this.updateMany(
    { _id: { $in: logIds } },
    { $set: { processed: true, processedAt: new Date() } }
  );
};



// Bulk insert for high performance
messageLogSchema.statics.bulkLog = function (logs) {
  return this.insertMany(logs, { ordered: false });
};




// Analytics methods
messageLogSchema.statics.getCampaignAnalytics = function (campaignId, timeframe = 24) {
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



messageLogSchema.statics.getUserStats = function (userId, timeframe = 24) {
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