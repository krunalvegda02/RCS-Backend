import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from '../src/db/index.js';

dotenv.config();

async function cleanupCompletedCampaigns() {
  try {
    await connectDB();
    console.log('🔄 Cleaning up completed campaigns...\n');
    
    const User = (await import('../src/models/user.model.js')).default;
    const Campaign = (await import('../src/models/campaign.model.js')).default;
    
    // Find all completed campaigns with blocked amounts
    const completedCampaigns = await Campaign.find({
      status: 'completed',
      blockedAmount: { $gt: 0 }
    });
    
    console.log(`Found ${completedCampaigns.length} completed campaigns with blocked amounts\n`);
    
    const userUpdates = new Map();
    
    for (const campaign of completedCampaigns) {
      console.log(`[Campaign ${campaign._id}] ${campaign.name}`);
      console.log(`  Status: ${campaign.status}`);
      console.log(`  Blocked: ₹${campaign.blockedAmount}`);
      console.log(`  Actual: ₹${campaign.actualCost}`);
      
      // Track how much to unblock per user
      const userId = campaign.userId.toString();
      if (!userUpdates.has(userId)) {
        userUpdates.set(userId, 0);
      }
      userUpdates.set(userId, userUpdates.get(userId) + campaign.blockedAmount);
      
      // Clear blocked amount from campaign
      campaign.blockedAmount = 0;
      await campaign.save();
      console.log(`  ✅ Cleared blocked amount\n`);
    }
    
    // Update user wallets
    console.log(`\n📊 Updating ${userUpdates.size} user wallets:\n`);
    
    for (const [userId, totalBlocked] of userUpdates.entries()) {
      const user = await User.findById(userId);
      if (user) {
        console.log(`[User] ${user.name} (${user.email})`);
        console.log(`  Current Blocked: ₹${user.wallet.blockedBalance}`);
        console.log(`  To Unblock: ₹${totalBlocked}`);
        
        // Unblock the amount
        user.wallet.blockedBalance = Math.max(0, user.wallet.blockedBalance - totalBlocked);
        user.wallet.lastUpdated = new Date();
        await user.save();
        
        console.log(`  New Blocked: ₹${user.wallet.blockedBalance}`);
        console.log(`  ✅ Updated\n`);
      }
    }
    
    console.log('✅ Done!');
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

cleanupCompletedCampaigns();
