
import mongoose from 'mongoose';

// ===== API RESULT MODEL =====
const apiResultSchema = new mongoose.Schema(
  {
    // Reference Information
    messageId: {
      type: String,
      required: true,
      index: true,
    },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // Request Details
    requestBody: mongoose.Schema.Types.Mixed,
    requestHeaders: mongoose.Schema.Types.Mixed,

    // Response Details
    statusCode: {
      type: Number,
      required: true,
      index: true,
    },
    responseBody: mongoose.Schema.Types.Mixed,
    responseHeaders: mongoose.Schema.Types.Mixed,

    // Status Mapping
    status: {
      type: String,
      enum: ['success', 'pending', 'failed', 'retry', 'invalid_number', 'unsupported'],
      index: true,
    },

    // Error Information
    errorCode: String,
    errorMessage: String,
    errorType: String, // 'network', 'validation', 'rate_limit', 'service', 'unknown'

    // Jio RCS Specific
    capabilityStatus: {
      type: String,
      enum: ['rcs_capable', 'not_capable', 'unknown'],
    },
    capabilityToken: String,
    rcsMessageId: String,

    // Timing
    requestTime: Date,
    responseTime: Date,
    responseTimeMs: Number,

    // Retry Information
    isRetry: Boolean,
    retryCount: Number,
    previousAttemptId: mongoose.Schema.Types.ObjectId,

    // Webhook Events (if received)
    webhookEvent: {
      type: {
        type: String,
        enum: ['delivered', 'failed', 'read', 'replied'],
      },
      timestamp: Date,
      eventData: mongoose.Schema.Types.Mixed,
    },

    // Cost
    cost: Number,
    currency: String,

    // Metadata
    ipAddress: String,
    userAgent: String,
    requestId: String,
  },
  {
    timestamps: true,
    collection: 'api_results',
  }
);

// Indexes
apiResultSchema.index({ userId: 1, createdAt: -1 });
apiResultSchema.index({ messageId: 1 });
apiResultSchema.index({ status: 1, createdAt: -1 });
apiResultSchema.index({ campaignId: 1, status: 1 });
apiResultSchema.index({ capabilityStatus: 1 });

// TTL Index - keep for 30 days
apiResultSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 2592000 }
);
export const APIResult = mongoose.model('APIResult', apiResultSchema);
export const Report = mongoose.model('Report', apiResultSchema);