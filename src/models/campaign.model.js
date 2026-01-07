
import mongoose from 'mongoose';

const campaignSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Campaign name is required'],
      trim: true,
      maxlength: 100,
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
      enum: ['pending', 'completed'],
      default: 'pending',
      index: true,
    },

    completedAt: Date,

    isArchived: {
      type: Boolean,
      default: true,
      index: true,
    },

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
      default: 0, // Based on RCS capable recipients only
    },
    actualCost: {
      type: Number,
      default: 0, // Actual amount charged
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

  // Get RCS capable count from recipients or ContactBatch data
  let rcsCapableCount = this.recipients.filter(r => r.isRcsCapable === true).length;
  let totalCount = this.recipients.length;

  // If no recipients but we might have ContactBatch data, check there
  if (this.recipients.length === 0) {
    try {
      const ContactBatch = mongoose.model('ContactBatch');
      const batchSummary = await ContactBatch.aggregate([
        { $match: { campaignId: this._id } },
        {
          $group: {
            _id: null,
            totalContacts: { $sum: '$totalContacts' },
            totalRcsCapable: { $sum: '$rcsCapableCount' }
          }
        }
      ]);

      if (batchSummary.length > 0) {
        totalCount = batchSummary[0].totalContacts || 0;
        rcsCapableCount = batchSummary[0].totalRcsCapable || 0;
      }
    } catch (error) {
      console.log('[Campaign] Could not access ContactBatch data for stats:', error.message);
    }
  }

  // Calculate cumulative stats (read includes delivered and sent, etc.)
  const stats = {
    total: totalCount,
    pending: statusCounts.pending,
    processing: statusCounts.processing + statusCounts.queued, // Include queued in processing
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
    rcsCapable: rcsCapableCount,
  };

  stats.successRate = stats.total > 0 ? (stats.delivered / stats.total) * 100 : 0;
  stats.failureRate = stats.total > 0 ? ((stats.failed + stats.bounced) / stats.total) * 100 : 0;
  stats.lastUpdatedAt = new Date();

  this.stats = stats;
  await this.save();
};

// Sync campaign recipients status from Message collection for accurate data
campaignSchema.methods.syncFromMessages = async function (force = false) {
  try {
    // Skip if recently synced (within last 10 seconds) unless forced
    if (!force && this.stats?.lastUpdatedAt) {
      const timeSinceLastSync = Date.now() - new Date(this.stats.lastUpdatedAt).getTime();
      if (timeSinceLastSync < 10 * 1000) {
        return { synced: false, reason: 'Recently synced', cached: true };
      }
    }

    const Message = mongoose.model('Message');
    const messages = await Message.find({ campaignId: this._id }).lean();

    if (messages.length === 0) {
      return { synced: false, reason: 'No messages found' };
    }

    // Create a map of messageId to message status
    const messageStatusMap = new Map();
    messages.forEach(msg => {
      messageStatusMap.set(msg.messageId, {
        status: msg.status,
        sentAt: msg.sentAt,
        deliveredAt: msg.deliveredAt,
        readAt: msg.readAt,
        failedAt: msg.failedAt,
        errorMessage: msg.errorMessage
      });
    });

    // Update recipients with message status
    let updated = 0;
    if (this.recipients && Array.isArray(this.recipients)) {
      this.recipients.forEach(recipient => {
        if (recipient.messageId && messageStatusMap.has(recipient.messageId)) {
          const msgData = messageStatusMap.get(recipient.messageId);
          recipient.status = msgData.status;
          recipient.sentAt = msgData.sentAt;
          recipient.deliveredAt = msgData.deliveredAt;
          recipient.readAt = msgData.readAt;
          recipient.failedAt = msgData.failedAt;
          recipient.errorMessage = msgData.errorMessage;
          updated++;
        }
      });
    }

    await this.save();
    await this.updateStats();

    return {
      synced: true,
      totalRecipients: this.recipients.length,
      updated: updated
    };
  } catch (error) {
    console.error('[Campaign] Error syncing from Messages:', error);
    return { synced: false, reason: error.message };
  }
};

// Sync ContactBatch data to main campaign recipients
campaignSchema.methods.syncFromContactBatches = async function () {
  try {
    const ContactBatch = mongoose.model('ContactBatch');
    const batches = await ContactBatch.find({ campaignId: this._id });

    if (batches.length === 0) {
      return { synced: false, reason: 'No contact batches found' };
    }

    // Build recipients array from batches
    const recipients = [];
    let totalRcsCapable = 0;

    for (const batch of batches) {
      if (batch.capabilityResults && batch.capabilityResults.length > 0) {
        for (const result of batch.capabilityResults) {
          recipients.push({
            phoneNumber: result.phoneNumber.replace(/^\+?91/, ''),
            variables: {},
            status: 'pending',
            isRcsCapable: result.isRcsCapable
          });

          if (result.isRcsCapable === true) {
            totalRcsCapable++;
          }
        }
      } else {
        for (const phone of batch.phoneNumbers) {
          recipients.push({
            phoneNumber: phone,
            variables: {},
            status: 'pending',
            isRcsCapable: null
          });
        }
      }
    }

    // Update campaign with recipients from batches
    this.recipients = recipients;
    this.stats.total = recipients.length;
    this.stats.pending = recipients.length;
    this.stats.rcsCapable = totalRcsCapable;

    await this.save();

    return {
      synced: true,
      totalRecipients: recipients.length,
      rcsCapable: totalRcsCapable
    };
  } catch (error) {
    console.error('[Campaign] Error syncing from ContactBatches:', error);
    return { synced: false, reason: error.message };
  }
};

// Get accurate RCS capable count from all sources
campaignSchema.methods.getAccurateRcsCount = async function () {
  // First try from recipients
  let rcsCapableCount = this.recipients.filter(r => r.isRcsCapable === true).length;
  let totalCount = this.recipients.length;

  // If no recipients, check ContactBatch data
  if (this.recipients.length === 0) {
    try {
      const ContactBatch = mongoose.model('ContactBatch');
      const batchSummary = await ContactBatch.aggregate([
        { $match: { campaignId: this._id } },
        {
          $group: {
            _id: null,
            totalContacts: { $sum: '$totalContacts' },
            totalRcsCapable: { $sum: '$rcsCapableCount' }
          }
        }
      ]);

      if (batchSummary.length > 0) {
        totalCount = batchSummary[0].totalContacts || 0;
        rcsCapableCount = batchSummary[0].totalRcsCapable || 0;
      }
    } catch (error) {
      console.log('[Campaign] Could not access ContactBatch data:', error.message);
    }
  }

  return {
    total: totalCount,
    rcsCapable: rcsCapableCount,
    source: this.recipients.length > 0 ? 'recipients' : 'contactBatches'
  };
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