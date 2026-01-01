import mongoose from 'mongoose';

const walletRequestSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
      min: [1, 'Amount must be greater than 0'],
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    requestedAt: {
      type: Date,
      default: Date.now,
    },
    processedAt: Date,
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    adminNote: {
      type: String,
      trim: true,
    },
    rejectionReason: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
    collection: 'walletRequests',
  }
);

// Indexes for performance
walletRequestSchema.index({ userId: 1, status: 1 });
walletRequestSchema.index({ status: 1, requestedAt: -1 });
walletRequestSchema.index({ createdAt: -1 });

export default mongoose.model('WalletRequest', walletRequestSchema);