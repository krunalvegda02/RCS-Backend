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
  phoneNumbers: [{
    type: String,
    required: true
  }],

  capablePhoneNumbers: [{
    type: String
  }],

  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending',
    index: true
  },

  rcsCapableCount: {
    type: Number,
    default: 0
  },
}, {
  timestamps: true
});







contactBatchSchema.index({ campaignId: 1, batchNumber: 1 });
contactBatchSchema.index({ userId: 1, status: 1 });

contactBatchSchema.methods.startProcessing = async function () {
  this.status = 'processing';
  this.processingStartedAt = new Date();
  await this.save();
};

contactBatchSchema.methods.updateCapabilityResults = async function (results, apiResponse = null) {
  this.capabilityResults = results.map(r => ({
    phoneNumber: r.phoneNumber,
    isRcsCapable: r.isCapable,
    features: r.features || [],
    checkedAt: new Date()
  }));

  // Store complete API response if provided
  if (apiResponse) {
    this.apiResponse = {
      reachableUsers: apiResponse.reachableUsers || [],
      totalRandomSampleUserCount: apiResponse.totalRandomSampleUserCount || 0,
      reachableRandomSampleUserCount: apiResponse.reachableRandomSampleUserCount || 0,
      processedAt: new Date()
    };
  }

  this.processedContacts = results.length;
  this.rcsCapableCount = results.filter(r => r.isCapable).length;
  this.status = 'completed';
  this.processingCompletedAt = new Date();
  await this.save();
};

contactBatchSchema.methods.fail = async function (error) {
  this.status = 'failed';
  this.error = error;
  this.processingCompletedAt = new Date();
  await this.save();
};

const ContactBatch = mongoose.model('ContactBatch', contactBatchSchema);

export default ContactBatch;
