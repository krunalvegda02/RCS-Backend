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
  excelParts: [{
    url: String,
    publicId: String,
    size: Number,
    partNumber: Number,
    totalParts: Number,
    rowsStart: Number,
    rowsEnd: Number
  }],
  cloudinaryPublicId: String,
  fileSize: Number,
  totalMessages: Number,
  stats: {
    total: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    delivered: { type: Number, default: 0 },
    read: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    pending: { type: Number, default: 0 },
    expired: { type: Number, default: 0 }
  },
  estimatedCost: { type: Number, default: 0 },
  actualCost: { type: Number, default: 0 },
  refundedAmount: { type: Number, default: 0 },
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
archivedCampaignSchema.index({ campaignCreatedAt: -1 });
archivedCampaignSchema.index({ userId: 1, campaignCreatedAt: -1 });
archivedCampaignSchema.index({ campaignCreatedAt: 1, archivedAt: -1 });

export default mongoose.model('ArchivedCampaign', archivedCampaignSchema);
