import mongoose from "mongoose";

const campaignStateSchema = new mongoose.Schema(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },

    templateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Template",
      required: true,
    },

    /* -------- MESSAGE IDENTIFIERS (PER CAMPAIGN) -------- */
    messageId: {
      type: String,
      required: true,
    },

    rcsMessageId: String,
    jioMessageId: {
      type: String,
      index: true,
    },
    externalMessageId: String,
    assistantId: String,

    /* -------- STATUS (PER CAMPAIGN) -------- */
    status: {
      type: String,
      enum: [
        "pending",
        "queued",
        "processing",
        "sent",
        "delivered",
        "failed",
        "bounced",
        "read",
        "replied",
        "expired",
      ],
      default: "pending",
    },

    /* -------- TIMESTAMPS -------- */
    queuedAt: Date,
    sentAt: Date,
    deliveredAt: Date,
    readAt: Date,
    failedAt: Date,
    lastWebhookAt: Date,

    /* -------- ERROR -------- */
    errorCode: String,
    errorMessage: String,

    /* -------- ENGAGEMENT -------- */
    clickedAt: Date,
    clickedAction: String,
    clickedUri: String,
    userText: String,
    suggestionResponse: mongoose.Schema.Types.Mixed,

    userClickCount: { type: Number, default: 0 },
    userReplyCount: { type: Number, default: 0 },
    lastInteractionAt: Date,

    /* -------- COST -------- */
    cost: Number,
  },
  { _id: false }
);

const contactCampaignMessageSchema = new mongoose.Schema(
  {
    /* ---------------- CONTACT ---------------- */
    recipientPhoneNumber: {
      type: String,
      required: true,
      index: true, // 🔥 Removed unique: true, using composite index instead
      match: /^[0-9]{10,15}$/,
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    /* ---------------- CAMPAIGN IDS ---------------- */
    campaignIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign"
    }],

    /* ---------------- CAMPAIGNS ARRAY ---------------- */
    campaigns: [campaignStateSchema],

    /* ---------------- CONTACT METADATA ---------------- */
    deviceType: String,
    ipAddress: String,
    userAgent: String,
  },
  {
    timestamps: true,
    collection: "contact_campaign_messages",
  }
);

// Indexes
contactCampaignMessageSchema.index({ userId: 1, createdAt: -1 });
contactCampaignMessageSchema.index({ "campaigns.campaignId": 1 });
contactCampaignMessageSchema.index({ "campaigns.status": 1 });
contactCampaignMessageSchema.index({ "campaigns.messageId": 1 });
contactCampaignMessageSchema.index(
  { recipientPhoneNumber: 1, userId: 1 },
  { unique: true }
);

export default mongoose.model(
  "ContactCampaignMessage",
  contactCampaignMessageSchema
);

