import mongoose from 'mongoose';

const archivedCampaignSchema = new mongoose.Schema({
  campaignId: {
    type: String,
    required: true,
    index: true
  },
  campaignName: {
    type: String,
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  userName: String,
  userEmail: String,
  botId: String,
  excelUrl: {
    type: String,
    required: true
  },
  cloudinaryPublicId: String,
  stats: {
    total: Number,
    sent: Number,
    delivered: Number,
    read: Number,
    failed: Number,
    expired: Number
  },
  estimatedCost: Number,
  actualCost: Number,
  refundedAmount: Number,
  campaignCreatedAt: Date,
  campaignCompletedAt: Date,
  archivedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  collection: 'archived_campaigns'
});

archivedCampaignSchema.index({ archivedAt: -1 });
archivedCampaignSchema.index({ userId: 1, archivedAt: -1 });

export default mongoose.model('ArchivedCampaign', archivedCampaignSchema);
