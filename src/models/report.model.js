import mongoose from 'mongoose';

// ===== REPORT MODEL =====
const reportSchema = new mongoose.Schema(
  {
    // Report Identification
    reportType: {
      type: String,
      enum: ['daily', 'weekly', 'monthly', 'campaign', 'custom'],
      required: true,
      index: true,
    },
    reportName: String,

    // Time Period
    startDate: {
      type: Date,
      required: true,
      index: true,
    },
    endDate: {
      type: Date,
      required: true,
    },

    // User/Campaign
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
    },

    // Core Metrics (aggregated for fast access)
    metrics: {
      totalMessages: Number,
      sentMessages: Number,
      deliveredMessages: Number,
      failedMessages: Number,
      bouncedMessages: Number,
      readMessages: Number,
      repliedMessages: Number,

      successRate: Number,
      failureRate: Number,
      deliveryRate: Number,
      engagementRate: Number,

      avgResponseTime: Number,
      totalCost: Number,
    },

    // Breakdown by Status
    statusBreakdown: {
      sent: Number,
      delivered: Number,
      failed: Number,
      bounced: Number,
      read: Number,
      replied: Number,
    },

    // Breakdown by Message Type
    messageTypeBreakdown: {
      richCard: Number,
      carousel: Number,
      textWithAction: Number,
      plainText: Number,
    },

    // Breakdown by Error Type
    errorBreakdown: {
      networkError: Number,
      validationError: Number,
      rateLimitError: Number,
      serviceError: Number,
      unknownError: Number,
    },

    // Capability Statistics
    capabilityStats: {
      rcsCapable: Number,
      notCapable: Number,
      unknown: Number,
    },

    // Top Performers
    topPerformingTemplates: [
      {
        templateId: mongoose.Schema.Types.ObjectId,
        templateName: String,
        successRate: Number,
        messageCount: Number,
      },
    ],
    topErrorReasons: [
      {
        errorCode: String,
        errorMessage: String,
        count: Number,
        percentage: Number,
      },
    ],

    // Time-series Data (for charts)
    hourlyData: [
      {
        hour: Number,
        date: Date,
        sent: Number,
        delivered: Number,
        failed: Number,
      },
    ],

    // Report Generation
    generatedAt: Date,
    generatedBy: mongoose.Schema.Types.ObjectId,
    dataSource: {
      type: String,
      enum: ['realtime', 'cached', 'manual'],
      default: 'realtime',
    },

    // File/Export
    reportUrl: String,
    fileFormat: {
      type: String,
      enum: ['pdf', 'csv', 'excel', 'json'],
    },

    // Status
    status: {
      type: String,
      enum: ['generating', 'ready', 'archived'],
      default: 'ready',
    },
  },
  {
    timestamps: true,
    collection: 'reports',
  }
);

// Indexes
reportSchema.index({ userId: 1, reportType: 1, startDate: -1 });
reportSchema.index({ campaignId: 1 });
reportSchema.index({ generatedAt: -1 });

export const Report = mongoose.model('Report', reportSchema);