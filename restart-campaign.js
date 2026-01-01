import mongoose from 'mongoose';
import Campaign from './src/models/campaign.model.js';
import jioRCSService from './src/services/JioRCS.service.js';

// Connect to MongoDB
await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/rcs_messaging');

try {
  console.log('🔄 Restarting campaigns with conservative rate limiting...');
  
  // Update ALL draft campaigns to running
  const result = await Campaign.updateMany(
    { status: 'draft' },
    { 
      status: 'running',
      startedAt: new Date()
    }
  );
  
  console.log(`✅ Updated ${result.modifiedCount} campaigns to running status`);
  
  // Get campaigns with pending recipients
  const campaigns = await Campaign.find({ 
    status: 'running',
    'recipients.status': 'pending'
  });
  
  console.log(`🚀 Found ${campaigns.length} campaigns with pending recipients`);
  
  // Start processing with staggered delays to prevent overload
  for (let i = 0; i < campaigns.length; i++) {
    const campaign = campaigns[i];
    const pendingCount = campaign.recipients.filter(r => r.status === 'pending').length;
    
    console.log(`📊 Campaign ${campaign._id}: ${pendingCount} pending recipients`);
    
    if (pendingCount > 0) {
      // Stagger campaign starts by 30 seconds each
      setTimeout(() => {
        console.log(`🚀 Starting processing for campaign: ${campaign._id}`);
        jioRCSService.processCampaignBatch(campaign._id, 100, 2000)
          .catch(error => console.error(`Processing error for ${campaign._id}:`, error.message));
      }, i * 30000); // 30 second delay between campaigns
    }
  }
  
  console.log('✅ All campaigns scheduled with conservative rate limiting!');
  console.log('⚠️ Processing will be slow to prevent API rate limits');
  
  setTimeout(() => {
    console.log('✅ Script completed');
    process.exit(0);
  }, 5000);
  
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}