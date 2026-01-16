import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from '../src/db/index.js';

dotenv.config();

async function checkWalletConsistency() {
  try {
    await connectDB();
    console.log('🔄 Checking wallet consistency...\n');
    
    const User = (await import('../src/models/user.model.js')).default;
    const Campaign = (await import('../src/models/campaign.model.js')).default;
    
    // Get user with blocked balance
    const user = await User.findOne({ 'wallet.blockedBalance': { $gt: 0 } });
    
    if (!user) {
      console.log('No users with blocked balance found');
      await mongoose.connection.close();
      process.exit(0);
    }
    
    console.log(`[User] ${user.name} (${user.email})`);
    console.log(`  Balance: ₹${user.wallet.balance}`);
    console.log(`  Blocked: ₹${user.wallet.blockedBalance}`);
    console.log(`  Available: ₹${user.wallet.balance - user.wallet.blockedBalance}\n`);
    
    // Find ALL campaigns for this user
    const allCampaigns = await Campaign.find({ userId: user._id }).sort({ createdAt: -1 }).limit(10);
    
    console.log(`Found ${allCampaigns.length} recent campaigns:\n`);
    
    let totalBlockedInCampaigns = 0;
    
    for (const campaign of allCampaigns) {
      console.log(`[Campaign ${campaign._id}]`);
      console.log(`  Name: ${campaign.name}`);
      console.log(`  Status: ${campaign.status}`);
      console.log(`  Blocked Amount: ₹${campaign.blockedAmount || 0}`);
      console.log(`  Estimated Cost: ₹${campaign.estimatedCost || 0}`);
      console.log(`  Actual Cost: ₹${campaign.actualCost || 0}`);
      console.log(`  Created: ${campaign.createdAt}`);
      
      if (campaign.blockedAmount > 0) {
        totalBlockedInCampaigns += campaign.blockedAmount;
      }
      console.log('');
    }
    
    console.log(`\n📊 Summary:`);
    console.log(`  Wallet Blocked: ₹${user.wallet.blockedBalance}`);
    console.log(`  Campaigns Blocked: ₹${totalBlockedInCampaigns}`);
    console.log(`  Difference: ₹${user.wallet.blockedBalance - totalBlockedInCampaigns}`);
    
    if (user.wallet.blockedBalance !== totalBlockedInCampaigns) {
      console.log(`\n⚠️  Inconsistency detected!`);
      console.log(`\n🔧 Fixing wallet blocked balance...`);
      
      user.wallet.blockedBalance = totalBlockedInCampaigns;
      user.wallet.lastUpdated = new Date();
      await user.save();
      
      console.log(`✅ Fixed! Blocked balance set to ₹${totalBlockedInCampaigns}`);
    } else {
      console.log(`\n✅ Wallet is consistent`);
    }
    
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkWalletConsistency();
