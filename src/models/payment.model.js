import mongoose from 'mongoose';

const PAYMENT_STATUS = {
    CREATED: 'created',
    AUTHORIZED: 'authorized',
    CAPTURED: 'captured',
    FAILED: 'failed',
    REFUNDED: 'refunded',
};

const paymentSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },

        // Razorpay Order Details
        razorpayOrderId: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },

        // Razorpay Payment Details (populated after payment)
        razorpayPaymentId: {
            type: String,
            sparse: true,
        },
        razorpaySignature: {
            type: String,
        },

        // Amount Details
        amount: {
            type: Number,
            required: true,
            min: 1,
        },
        currency: {
            type: String,
            default: 'INR',
        },

        // Credits to be added (can be same as amount or calculated)
        creditsToAdd: {
            type: Number,
            required: true,
            min: 1,
        },

        // Payment Status
        status: {
            type: String,
            enum: Object.values(PAYMENT_STATUS),
            default: PAYMENT_STATUS.CREATED,
            index: true,
        },

        // Payment Method (card, upi, netbanking, wallet)
        method: {
            type: String,
        },

        // Bank/Wallet details
        bank: String,
        wallet: String,
        vpa: String, // UPI VPA

        // Card details (masked)
        cardNetwork: String,
        cardLast4: String,

        // Error details (if failed)
        errorCode: String,
        errorDescription: String,
        errorReason: String,

        // Additional notes
        notes: {
            type: Map,
            of: String,
        },

        // Receipt ID for reference
        receipt: String,

        // Timestamps
        paidAt: Date,
        verifiedAt: Date,
        refundedAt: Date,

        // Wallet transaction reference
        walletTransactionId: {
            type: mongoose.Schema.Types.ObjectId,
        },




        // Invoice / Receipt
        razorpayInvoiceId: {
            type: String,
            index: true,
        },

        invoiceUrl: {
            type: String,
        },

        receiptUrl: {
            type: String,
        },

    },
    {
        timestamps: true,
        collection: 'payments',
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

// Indexes for performance
paymentSchema.index({ userId: 1, status: 1 });
paymentSchema.index({ status: 1, createdAt: -1 });
paymentSchema.index({ createdAt: -1 });
paymentSchema.index({ razorpayPaymentId: 1 }, { sparse: true });

// Virtual for display amount (in Rupees)
paymentSchema.virtual('displayAmount').get(function () {
    return `₹${this.amount.toLocaleString('en-IN')}`;
});

// Virtual for user-friendly status
paymentSchema.virtual('displayStatus').get(function () {
    const statusMap = {
        created: 'Pending',
        authorized: 'Processing',
        captured: 'Success',
        failed: 'Failed',
        refunded: 'Refunded',
    };
    return statusMap[this.status] || this.status;
});

// Method to mark payment as captured
paymentSchema.methods.markAsCaptured = async function (paymentDetails) {
    this.status = PAYMENT_STATUS.CAPTURED;
    this.razorpayPaymentId = paymentDetails.paymentId;
    this.razorpaySignature = paymentDetails.signature;
    this.method = paymentDetails.method;
    this.paidAt = new Date();
    this.verifiedAt = new Date();

    if (paymentDetails.card) {
        this.cardNetwork = paymentDetails.card.network;
        this.cardLast4 = paymentDetails.card.last4;
    }
    if (paymentDetails.bank) {
        this.bank = paymentDetails.bank;
    }
    if (paymentDetails.wallet) {
        this.wallet = paymentDetails.wallet;
    }
    if (paymentDetails.vpa) {
        this.vpa = paymentDetails.vpa;
    }

    await this.save();
    return this;
};

// Method to mark payment as failed
paymentSchema.methods.markAsFailed = async function (errorDetails = {}) {
    this.status = PAYMENT_STATUS.FAILED;
    this.errorCode = errorDetails.code;
    this.errorDescription = errorDetails.description;
    this.errorReason = errorDetails.reason;
    await this.save();
    return this;
};

// Static method to find by Razorpay order ID
paymentSchema.statics.findByOrderId = function (razorpayOrderId) {
    return this.findOne({ razorpayOrderId });
};

// Static method to find by Razorpay payment ID
paymentSchema.statics.findByPaymentId = function (razorpayPaymentId) {
    return this.findOne({ razorpayPaymentId });
};

// Static method to get user payment stats
paymentSchema.statics.getUserPaymentStats = async function (userId) {
    const stats = await this.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(userId), status: PAYMENT_STATUS.CAPTURED } },
        {
            $group: {
                _id: null,
                totalPayments: { $sum: 1 },
                totalAmount: { $sum: '$amount' },
                totalCredits: { $sum: '$creditsToAdd' },
            },
        },
    ]);

    return stats[0] || { totalPayments: 0, totalAmount: 0, totalCredits: 0 };
};

export { PAYMENT_STATUS };
export default mongoose.model('Payment', paymentSchema);
