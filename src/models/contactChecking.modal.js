const contactCheckingSchema = new mongoose.Schema({
  campaignIds: [{
    type: mongoose.Schema.Types.ObjectId,
    index: true
  }],
  contact: {
    type: String,
    required: true,
    index: true
  },
  isRcsCapable: {
    type: Boolean,
    default: null,
    index: true
  },
  status: {
    type: String,
    enum: ['pending', 'completed'],
    default: 'pending',
    index: true
  }
}, { timestamps: true });

// ✅ compound index (VERY IMPORTANT)
contactCheckingSchema.index(
  { contact: 1 },
  { unique: true }
);

const ContactChecking = mongoose.model(
  'ContactChecking',
  contactCheckingSchema
);
export default ContactChecking;