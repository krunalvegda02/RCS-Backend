import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Campaign from '../models/campaign.model.js';
import Message from '../models/message.model.js';

dotenv.config();

const syncAllCampaigns = async () => {
  try {
    const campaigns = await Campaign.find({});
    console.log(`[${new Date().toLocaleTimeString()}] Syncing ${campaigns.length} campaigns...`);

    let synced = 0;
    for (const campaign of campaigns) {
      const result = await campaign.syncFromMessages(true);
      if (result.synced) synced++;
    }

    console.log(`[${new Date().toLocaleTimeString()}] ✓ Synced ${synced} campaigns\n`);
  } catch (error) {
    console.error('Sync error:', error.message);
  }
};

const startSync = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB - Auto-sync every 15 seconds\n');
  
  await syncAllCampaigns();
  setInterval(syncAllCampaigns, 15000);
};

startSync();
