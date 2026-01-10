import mongoose from 'mongoose';
import { sendCampaignMessages } from './src/services/campaignSender.service.js';

const MONGODB_URI = 'mongodb+srv://krunalvegda02:krunalvegda02@cluster0.jwybog2.mongodb.net/test?retryWrites=true&w=majority';

async function testSend() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    const campaignId = process.argv[2];
    const userId = process.argv[3];
    
    if (!campaignId || !userId) {
      console.log('Usage: node testSend.js <campaignId> <userId>');
      process.exit(1);
    }
    
    console.log(`Sending campaign ${campaignId} for user ${userId}`);
    
    const result = await sendCampaignMessages(campaignId, userId);
    console.log('Result:', result);
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

testSend();
