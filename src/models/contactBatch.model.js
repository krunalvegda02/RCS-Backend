import mongoose from 'mongoose';

const contactBatchSchema = new mongoose.Schema({
  campaignId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Campaign',
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  batchNumber: {
    type: Number,
    required: true
  },
  contacts: [{
    phoneNumber: {
      type: String,
      required: true
    },
    isRcsCapable: {
      type: Boolean,
      default: null
    },
    variables: {
      type: Map,
      of: String,
      default: {}
    }
  }],
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending',
    index: true
  },
  totalContacts: {
    type: Number,
    required: true
  },
  processedContacts: {
    type: Number,
    default: 0
  },
  rcsCapableCount: {
    type: Number,
    default: 0
  },
  processingStartedAt: Date,
  processingCompletedAt: Date,
  error: String
}, {
  timestamps: true
});

// Compound index for efficient queries
contactBatchSchema.index({ campaignId: 1, batchNumber: 1 });
contactBatchSchema.index({ userId: 1, status: 1 });

// Mark batch as processing
contactBatchSchema.methods.startProcessing = async function() {
  this.status = 'processing';
  this.processingStartedAt = new Date();
  await this.save();
};

// Mark batch as completed
contactBatchSchema.methods.complete = async function(rcsCapableCount) {
  this.status = 'completed';
  this.processedContacts = this.totalContacts;
  this.rcsCapableCount = rcsCapableCount;
  this.processingCompletedAt = new Date();
  await this.save();
};

// Mark batch as failed
contactBatchSchema.methods.fail = async function(error) {
  this.status = 'failed';
  this.error = error;
  this.processingCompletedAt = new Date();
  await this.save();
};

const ContactBatch = mongoose.model('ContactBatch', contactBatchSchema);

export default ContactBatch;
