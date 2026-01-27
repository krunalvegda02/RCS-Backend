import mongoose from "mongoose";


const contactCampaignMessageSchema = new mongoose.Schema(
  {
    /* ---------------- IDENTIFIERS ---------------- */
    messageId: {
      type: String,
      required: true
    },

    recipientPhoneNumber: {
      type: String,
      required: true,
      match: /^[0-9]{10,15}$/,
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      required: true,
    },

    templateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Template",
      required: true,
    },

    rcsMessageId: { type: String },
    jioMessageId: { type: String },
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

// Indexes for webhook processing (O(1) lookups)
contactCampaignMessageSchema.index({ messageId: 1 }, { unique: true });
contactCampaignMessageSchema.index({ jioMessageId: 1 }, { sparse: true });
contactCampaignMessageSchema.index({ rcsMessageId: 1 }, { sparse: true });

// Indexes for campaign queries
contactCampaignMessageSchema.index({ userId: 1, createdAt: -1 });
contactCampaignMessageSchema.index({ campaignId: 1, createdAt: -1 }); // Optimized for FLAT model
contactCampaignMessageSchema.index({ "campaigns.campaignId": 1, createdAt: -1 }); // Optimized for NESTED model
contactCampaignMessageSchema.index({ campaignId: 1, status: 1, createdAt: -1 });
contactCampaignMessageSchema.index({ "campaigns.campaignId": 1, "campaigns.status": 1, createdAt: -1 });

export default mongoose.model(
  "ContactCampaignMessage",
  contactCampaignMessageSchema
);
