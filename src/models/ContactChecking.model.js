import mongoose from 'mongoose';

const contactCheckingSchema = new mongoose.Schema({
  contact: {
    type: String,
    required: true,
    index: true
  },
  campaignIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Campaign'
  }],
  status: {
    type: String,
    enum: ['pending', 'checked', 'failed'],
    default: 'pending'
  },
  isRcsCapable: {
    type: Boolean,
    default: null
  },
  lastCheckedAt: {
    type: Date
  }
}, {
  timestamps: true
});

contactCheckingSchema.index({ contact: 1, campaignIds: 1 });

const ContactChecking = mongoose.model('ContactChecking', contactCheckingSchema);

export default ContactChecking;
