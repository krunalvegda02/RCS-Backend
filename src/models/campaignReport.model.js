import mongoose from 'mongoose';

const campaignReportSchema = new mongoose.Schema(
  {
    // Campaign Reference
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // Campaign Basic Info
    campaignName: {
      type: String,
      required: true,
    },
    templateType: {
      type: String,
      enum: ['richCard', 'carousel', 'textWithAction', 'plainText'],
      required: true,
    },

    // Message Statistics
    messageStats: {
      totalRecipients: {
        type: Number,
        default: 0,
      },
      totalSent: {
        type: Number,
        default: 0,
      },
      totalDelivered: {
        type: Number,
        default: 0,
      },
      totalFailed: {
        type: Number,
        default: 0,
      },
      totalPending: {
        type: Number,
        default: 0,
      },
      totalRead: {
        type: Number,
        default: 0,
      },
      totalReplied: {
        type: Number,
        default: 0,
      },
      totalClicked: {
        type: Number,
        default: 0,
      },
    },

    // Performance Metrics
    performance: {
      deliveryRate: {
        type: Number,
        default: 0,
        min: 0,
        max: 100,
      },
      readRate: {
        type: Number,
        default: 0,
        min: 0,
        max: 100,
      },
      clickRate: {
        type: Number,
        default: 0,
        min: 0,
        max: 100,
      },
      replyRate: {
        type: Number,
        default: 0,
        min: 0,
        max: 100,
      },
      failureRate: {
        type: Number,
        default: 0,
        min: 0,
        max: 100,
      },
    },

    // Cost Analysis
    costAnalysis: {
      totalCost: {
        type: Number,
        default: 0,
      },
      costPerMessage: {
        type: Number,
        default: 0,
      },
      costPerDelivery: {
        type: Number,
        default: 0,
      },
      currency: {
        type: String,
        default: 'INR',
      },
    },

    // Time Analysis
    timeAnalysis: {
      campaignStartTime: Date,
      campaignEndTime: Date,
      totalDuration: Number, // in minutes
      avgDeliveryTime: Number, // in seconds
      peakSendingHour: Number, // 0-23
    },

    // Error Analysis
    errorAnalysis: {
      errorBreakdown: [
        {
          errorCode: String,
          errorMessage: String,
          count: Number,
          percentage: Number,
        }
      ],
      topFailureReasons: [
        {
          reason: String,
          count: Number,
          percentage: Number,
        }
      ],
    },

   

    // Status & Timestamps
    reportStatus: {
      type: String,
      enum: ['generating', 'completed', 'failed'],
      default: 'generating',
    },
    generatedAt: {
      type: Date,
      default: Date.now,
    },
    lastUpdatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: 'campaignReports',
  }
);

// Indexes
campaignReportSchema.index({ userId: 1, generatedAt: -1 });
campaignReportSchema.index({ campaignId: 1 });
campaignReportSchema.index({ reportStatus: 1 });

// Methods
campaignReportSchema.methods.generateReport = async function () {
  const Message = mongoose.model('Message');
  const Campaign = mongoose.model('Campaign');

  try {
    // Get campaign details
    const campaign = await Campaign.findById(this.campaignId);
    if (!campaign) throw new Error('Campaign not found');

    // Get all messages for this campaign
    const messages = await Message.find({ campaignId: this.campaignId });

    // Calculate message statistics
    this.messageStats = {
      totalRecipients: campaign.recipients.length,
      totalSent: messages.filter(m => ['sent', 'delivered', 'read', 'replied'].includes(m.status)).length,
      totalDelivered: messages.filter(m => m.status === 'delivered').length,
      totalFailed: messages.filter(m => ['failed', 'bounced'].includes(m.status)).length,
      totalPending: messages.filter(m => ['draft', 'queued'].includes(m.status)).length,
      totalRead: messages.filter(m => m.status === 'read').length,
      totalReplied: messages.filter(m => m.status === 'replied').length,
      totalClicked: messages.filter(m => m.clickedAt).length,
    };

    // Calculate performance metrics
    const { totalSent, totalDelivered, totalRead, totalClicked, totalReplied, totalFailed, totalRecipients } = this.messageStats;
    
    this.performance = {
      deliveryRate: totalSent > 0 ? (totalDelivered / totalSent) * 100 : 0,
      readRate: totalDelivered > 0 ? (totalRead / totalDelivered) * 100 : 0,
      clickRate: totalDelivered > 0 ? (totalClicked / totalDelivered) * 100 : 0,
      replyRate: totalDelivered > 0 ? (totalReplied / totalDelivered) * 100 : 0,
      failureRate: totalRecipients > 0 ? (totalFailed / totalRecipients) * 100 : 0,
    };

    // Calculate cost analysis
    const totalCost = messages.reduce((sum, m) => sum + (m.cost || 0), 0);
    this.costAnalysis = {
      totalCost,
      costPerMessage: totalSent > 0 ? totalCost / totalSent : 0,
      costPerDelivery: totalDelivered > 0 ? totalCost / totalDelivered : 0,
      currency: 'INR',
    };

    // Calculate time analysis
    const sentMessages = messages.filter(m => m.sentAt);
    if (sentMessages.length > 0) {
      const startTime = new Date(Math.min(...sentMessages.map(m => m.sentAt)));
      const endTime = new Date(Math.max(...sentMessages.map(m => m.sentAt)));
      
      this.timeAnalysis = {
        campaignStartTime: startTime,
        campaignEndTime: endTime,
        totalDuration: (endTime - startTime) / (1000 * 60), // minutes
        avgDeliveryTime: sentMessages.reduce((sum, m) => {
          return sum + (m.deliveredAt && m.sentAt ? (m.deliveredAt - m.sentAt) / 1000 : 0);
        }, 0) / sentMessages.length,
        peakSendingHour: this.calculatePeakHour(sentMessages),
      };
    }

    // Calculate error analysis
    const failedMessages = messages.filter(m => m.errorCode);
    const errorBreakdown = {};
    failedMessages.forEach(m => {
      const key = `${m.errorCode}:${m.errorMessage}`;
      errorBreakdown[key] = (errorBreakdown[key] || 0) + 1;
    });

    this.errorAnalysis = {
      errorBreakdown: Object.entries(errorBreakdown).map(([key, count]) => {
        const [errorCode, errorMessage] = key.split(':');
        return {
          errorCode,
          errorMessage,
          count,
          percentage: (count / totalFailed) * 100,
        };
      }),
      topFailureReasons: campaign.recipients
        .filter(r => r.failureReason)
        .reduce((acc, r) => {
          const existing = acc.find(item => item.reason === r.failureReason);
          if (existing) {
            existing.count++;
          } else {
            acc.push({ reason: r.failureReason, count: 1 });
          }
          return acc;
        }, [])
        .map(item => ({
          ...item,
          percentage: (item.count / totalFailed) * 100,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
    };

    // Calculate engagement analysis
    const clickedMessages = messages.filter(m => m.clickedAction);
    const actionBreakdown = {};
    clickedMessages.forEach(m => {
      actionBreakdown[m.clickedAction] = (actionBreakdown[m.clickedAction] || 0) + 1;
    });

    this.engagementAnalysis = {
      clicksByAction: Object.entries(actionBreakdown).map(([action, count]) => ({
        actionType: action,
        count,
        percentage: (count / totalClicked) * 100,
      })),
      popularClickTimes: this.calculateClickTimes(clickedMessages),
      deviceBreakdown: this.calculateDeviceBreakdown(messages),
    };

    this.reportStatus = 'completed';
    this.lastUpdatedAt = new Date();
    
    await this.save();
    return this;
  } catch (error) {
    this.reportStatus = 'failed';
    await this.save();
    throw error;
  }
};

campaignReportSchema.methods.calculatePeakHour = function (messages) {
  const hourCounts = {};
  messages.forEach(m => {
    const hour = new Date(m.sentAt).getHours();
    hourCounts[hour] = (hourCounts[hour] || 0) + 1;
  });
  
  return Object.entries(hourCounts).reduce((peak, [hour, count]) => {
    return count > (hourCounts[peak] || 0) ? parseInt(hour) : peak;
  }, 0);
};

campaignReportSchema.methods.calculateClickTimes = function (messages) {
  const hourCounts = {};
  messages.forEach(m => {
    if (m.clickedAt) {
      const hour = new Date(m.clickedAt).getHours();
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    }
  });
  
  return Object.entries(hourCounts).map(([hour, count]) => ({
    hour: parseInt(hour),
    count,
  })).sort((a, b) => b.count - a.count);
};

campaignReportSchema.methods.calculateDeviceBreakdown = function (messages) {
  const deviceCounts = {};
  messages.forEach(m => {
    if (m.deviceType) {
      deviceCounts[m.deviceType] = (deviceCounts[m.deviceType] || 0) + 1;
    }
  });
  
  const total = Object.values(deviceCounts).reduce((sum, count) => sum + count, 0);
  return Object.entries(deviceCounts).map(([device, count]) => ({
    deviceType: device,
    count,
    percentage: total > 0 ? (count / total) * 100 : 0,
  }));
};

// Static methods
campaignReportSchema.statics.generateForCampaign = async function (campaignId) {
  const Campaign = mongoose.model('Campaign');
  const campaign = await Campaign.findById(campaignId);
  
  if (!campaign) throw new Error('Campaign not found');
  
  // Check if report already exists
  let report = await this.findOne({ campaignId });
  
  if (!report) {
    report = new this({
      campaignId,
      userId: campaign.userId,
      campaignName: campaign.name,
      templateType: campaign.templateType || 'plainText',
    });
  }
  
  return await report.generateReport();
};

export default mongoose.model('CampaignReport', campaignReportSchema);