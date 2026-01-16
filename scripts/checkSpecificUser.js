import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from '../src/db/index.js';

dotenv.config();

async function checkSpecificUser() {
  try {
    await connectDB();
    
    const User = (await import('../src/models/user.model.js')).default;
    const Campaign = (await import('../src/models/campaign.model.js')).default;
    
    // Find user by email
    const user = await User.findOne({ email: 'largemedia@gmail.com' });
    
    if (!user) {
      console.log('User not found');
      await mongoose.connection.close();
      process.exit(0);
    }
    
    console.log(`\n[User] ${user.name} (${user.email})`);
    console.log(`  Balance: ₹${user.wallet.balance}`);
    console.log(`  Blocked: ₹${user.wallet.blockedBalance}`);
    console.log(`  Available: ₹${user.wallet.balance - user.wallet.blockedBalance}\n`);
    
    // Find ALL campaigns
    const allCampaigns = await Campaign.find({ userId: user._id }).sort({ createdAt: -1 });
    
    console.log(`Found ${allCampaigns.length} total campaigns\n`);
    
    let totalBlockedInCampaigns = 0;
    const incompleteCampaigns = [];
    
    for (const campaign of allCampaigns) {
      if (campaign.blockedAmount > 0 || campaign.status !== 'completed') {
        console.log(`[Campaign ${campaign._id}]`);
        console.log(`  Name: ${campaign.name}`);
        console.log(`  Status: ${campaign.status}`);
        console.log(`  Blocked: ₹${campaign.blockedAmount || 0}`);
        console.log(`  Estimated: ₹${campaign.estimatedCost || 0}`);
        console.log(`  Actual: ₹${campaign.actualCost || 0}`);
        console.log(`  Created: ${campaign.createdAt}\n`);
        
        if (campaign.blockedAmount > 0) {
          totalBlockedInCampaigns += campaign.blockedAmount;
          if (campaign.status !== 'completed') {
            incompleteCampaigns.push(campaign);
          }
        }
      }
    }
    
    console.log(`\n📊 Summary:`);
    console.log(`  Wallet Blocked: ₹${user.wallet.blockedBalance}`);
    console.log(`  Campaigns Blocked: ₹${totalBlockedInCampaigns}`);
    console.log(`  Incomplete Campaigns: ${incompleteCampaigns.length}`);
    
    if (user.wallet.blockedBalance > 0 && totalBlockedInCampaigns === 0) {
      console.log(`\n⚠️  Wallet has blocked balance but no campaigns have blocked amounts!`);
      console.log(`🔧 Resetting wallet blocked balance to 0...`);
      
      user.wallet.blockedBalance = 0;
      user.wallet.lastUpdated = new Date();
      await user.save();
      
      console.log(`✅ Fixed! Blocked balance reset to 0`);
    }
    
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkSpecificUser();
