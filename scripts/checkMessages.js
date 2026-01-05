import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const Message = mongoose.model('Message', new mongoose.Schema({
  messageId: String,
  campaignId: mongoose.Schema.Types.ObjectId,
  status: String,
  recipientPhoneNumber: String
}, { timestamps: true, collection: 'messages' }));

const Campaign = mongoose.model('Campaign', new mongoose.Schema({
  name: String,
  status: String
}, { timestamps: true, collection: 'campaigns' }));

async function checkMessages() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const messages = await Message.find({}).populate('campaignId', 'name');
    
    console.log(`📊 Total Messages: ${messages.length}\n`);
    
    const byCampaign = {};
    messages.forEach(m => {
      const campaignName = m.campaignId?.name || 'Unknown';
      const campaignId = m.campaignId?._id || 'Unknown';
      const key = `${campaignName} (${campaignId})`;
      
      if (!byCampaign[key]) {
        byCampaign[key] = {};
      }
      byCampaign[key][m.status] = (byCampaign[key][m.status] || 0) + 1;
    });
    
    console.log('Messages by Campaign:\n');
    Object.entries(byCampaign).forEach(([campaign, statuses]) => {
      console.log(`📋 ${campaign}`);
      console.log('   Statuses:', statuses);
      console.log('');
    });
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkMessages();
