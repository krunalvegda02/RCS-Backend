import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../src/models/user.model.js';
import Campaign from '../src/models/campaign.model.js';
import ContactCampaignMessage from '../src/models/contact_campaign_message.model.js';

dotenv.config();

async function debugLatest() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const user = await User.findOne({ email: 'largemedia@gmail.com' });
  console.log('👤 User Wallet:', {
    balance: user.wallet.balance,
    blockedBalance: user.wallet.blockedBalance,
    available: user.wallet.balance - user.wallet.blockedBalance
  });
  
  const campaign = await Campaign.findOne({ userId: user._id }).sort({ createdAt: -1 });
  
  console.log('\n📊 Latest Campaign:', campaign._id.toString());
  console.log('Status:', campaign.status);
  console.log('Blocked Amount:', campaign.blockedAmount);
  console.log('Actual Cost:', campaign.actualCost);
  console.log('Created:', campaign.createdAt);
  
  const messages = await ContactCampaignMessage.find({
    userId: user._id,
    'campaigns.campaignId': campaign._id
  }).select('phone campaigns.$');
  
  console.log('\n📱 Messages:', messages.length);
  
  const statusCount = {};
  messages.forEach(m => {
    const status = m.campaigns[0]?.status || 'unknown';
    statusCount[status] = (statusCount[status] || 0) + 1;
  });
  
  console.log('Status breakdown:', statusCount);
  
  const pending = ['draft', 'queued', 'pending', 'sent'].reduce((sum, s) => sum + (statusCount[s] || 0), 0);
  const processed = ['delivered', 'read', 'replied', 'failed', 'expired'].reduce((sum, s) => sum + (statusCount[s] || 0), 0);
  
  console.log('\nPending:', pending);
  console.log('Processed:', processed);
  console.log('Total:', messages.length);
  console.log('\n⚠️  Should Complete:', messages.length > 0 && pending === 0 && campaign.status !== 'completed');
  
  if (messages.length > 0 && pending === 0 && campaign.status !== 'completed') {
    console.log('\n🔧 Manually completing campaign...');
    try {
      await campaign.completeCampaign();
      console.log('✅ Campaign completed successfully');
      
      const updatedUser = await User.findById(user._id);
      console.log('\n👤 Updated Wallet:', {
        balance: updatedUser.wallet.balance,
        blockedBalance: updatedUser.wallet.blockedBalance,
        available: updatedUser.wallet.balance - updatedUser.wallet.blockedBalance
      });
    } catch (error) {
      console.error('❌ Error:', error.message);
    }
  }
  
  await mongoose.disconnect();
}

debugLatest().catch(console.error);
