import mongoose from 'mongoose';

const demoRequestSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },
  company: { type: String },
  companySize: { type: String },
  date: { type: String },
  time: { type: String },
  timezone: { type: String, default: 'Asia/Kolkata' },
  meetingLink: { type: String },
  message: { type: String },
  source: { type: String, default: 'website' },
  status: { 
    type: String, 
    enum: ['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'], 
    default: 'SCHEDULED' 
  },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('DemoRequest', demoRequestSchema);
