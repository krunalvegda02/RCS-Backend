import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const Campaign = mongoose.model('Campaign', new mongoose.Schema({
  name: String,
  status: String,
  recipients: [{
    phoneNumber: String,
    status: String
  }]
}, { timestamps: true, collection: 'campaigns' }));

async function listAllCampaigns() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const campaigns = await Campaign.find({}).select('name status recipients.status createdAt');
    
    console.log(`📊 Total Campaigns: ${campaigns.length}\n`);
    
    campaigns.forEach(c => {
      const statuses = {};
      c.recipients?.forEach(r => {
        statuses[r.status] = (statuses[r.status] || 0) + 1;
      });
      
      console.log(`\n📋 ${c.name} (${c.status})`);
      console.log(`   ID: ${c._id}`);
      console.log(`   Recipients:`, statuses);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

listAllCampaigns();
