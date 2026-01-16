import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../src/models/user.model.js';
import Campaign from '../src/models/campaign.model.js';

dotenv.config();

async function testCompleteCampaign() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const user = await User.findOne({ email: 'largemedia@gmail.com' });
  
  console.log('Before test:');
  console.log('Wallet:', {
    balance: user.wallet.balance,
    blockedBalance: user.wallet.blockedBalance
  });
  
  // Create a test campaign
  const campaign = new Campaign({
    name: 'Test Wallet Flow',
    userId: user._id,
    templateId: new mongoose.Types.ObjectId(),
    botId: 'bot1',
    status: 'running',
    estimatedCost: 5,
    blockedAmount: 5
  });
  await campaign.save();
  
  console.log('\nCreated test campaign:', campaign._id.toString().slice(-6));
  console.log('Blocked amount:', campaign.blockedAmount);
  
  // Block wallet
  await User.findByIdAndUpdate(user._id, {
    $inc: { 'wallet.blockedBalance': 5 }
  });
  
  const userAfterBlock = await User.findById(user._id);
  console.log('\nAfter blocking:');
  console.log('Wallet:', {
    balance: userAfterBlock.wallet.balance,
    blockedBalance: userAfterBlock.wallet.blockedBalance
  });
  
  // Complete campaign
  console.log('\nCompleting campaign...');
  await campaign.completeCampaign();
  
  // Check results
  const updatedCampaign = await Campaign.findById(campaign._id);
  const updatedUser = await User.findById(user._id);
  
  console.log('\nAfter completion:');
  console.log('Campaign blockedAmount:', updatedCampaign.blockedAmount, updatedCampaign.blockedAmount === 0 ? '✅' : '❌');
  console.log('Campaign status:', updatedCampaign.status);
  console.log('Wallet:', {
    balance: updatedUser.wallet.balance,
    blockedBalance: updatedUser.wallet.blockedBalance
  });
  
  // Cleanup
  await Campaign.findByIdAndDelete(campaign._id);
  await User.findByIdAndUpdate(user._id, {
    $inc: { 'wallet.balance': 5 }
  });
  
  console.log('\n✅ Test complete and cleaned up');
  
  await mongoose.disconnect();
}

testCompleteCampaign().catch(console.error);
