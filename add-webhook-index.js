import mongoose from 'mongoose';
import ContactCampaignMessage from './src/models/message.model.js';
import connectDB from './src/db/index.js';

async function addIndex() {
  await connectDB();
  
  // Critical index for webhook lookups
  await ContactCampaignMessage.collection.createIndex(
    { 'campaigns.messageId': 1 },
    { name: 'webhook_lookup_idx' }
  );
  
  console.log('✅ Index created: campaigns.messageId');
  process.exit(0);
}

addIndex();
