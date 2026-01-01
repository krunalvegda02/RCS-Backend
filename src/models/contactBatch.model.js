import mongoose from 'mongoose';

const contactBatchSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  batchId: { type: String, required: true, unique: true },
  filename: String,
  totalContacts: { type: Number, default: 0 },
  processedContacts: { type: Number, default: 0 },
  rcsCapable: { type: Number, default: 0 },
  nonRcsCapable: { type: Number, default: 0 },
  errors: { type: Number, default: 0 },
  status: { 
    type: String, 
    enum: ['processing', 'completed', 'failed', 'campaign_active'], 
    default: 'processing' 
  },
  
  // Campaign integration fields
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign' },
  templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Template' },
  campaignName: String,
  autoSendEnabled: { type: Boolean, default: false },
  
  contacts: [{
    phoneNumber: String,
    isCapable: { type: Boolean, default: null },
    capabilityToken: String,
    status: { type: String, enum: ['pending', 'checked', 'error', 'sent', 'failed'], default: 'pending' },
    error: String,
    checkedAt: Date,
    messageId: String,
    sentAt: Date,
    variables: { type: Object, default: {} }
  }],
  
  createdAt: { type: Date, default: Date.now },
  completedAt: Date
});

contactBatchSchema.methods.updateProgress = function() {
  this.processedContacts = this.contacts.filter(c => c.status !== 'pending').length;
  this.rcsCapable = this.contacts.filter(c => c.isCapable === true).length;
  this.nonRcsCapable = this.contacts.filter(c => c.isCapable === false).length;
  this.errors = this.contacts.filter(c => c.status === 'error').length;
  
  if (this.processedContacts === this.totalContacts) {
    this.status = this.autoSendEnabled ? 'campaign_active' : 'completed';
    this.completedAt = new Date();
  }
};

// Get contacts ready for messaging
contactBatchSchema.methods.getReadyContacts = function() {
  return this.contacts.filter(c => c.isCapable === true && c.status === 'checked');
};

export default mongoose.model('ContactBatch', contactBatchSchema);