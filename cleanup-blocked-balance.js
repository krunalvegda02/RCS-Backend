/**
 * Cleanup script to unblock balance for completed campaigns
 * Run this once to fix existing data
 */

import mongoose from 'mongoose';
import User from './src/models/user.model.js';
import Campaign from './src/models/campaign.model.js';

const MONGODB_URI = 'mongodb+srv://krunalvegda02:krunalvegda02@cluster0.jwybog2.mongodb.net/test?retryWrites=true&w=majority';

async function cleanupBlockedBalance() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Find all completed campaigns with blocked amount
    const completedCampaigns = await Campaign.find({
      status: 'completed',
      blockedAmount: { $gt: 0 }
    }).select('_id userId name blockedAmount actualCost');

    console.log(`Found ${completedCampaigns.length} completed campaigns with blocked balance\n`);

    for (const campaign of completedCampaigns) {
      const remainingBlocked = campaign.blockedAmount - (campaign.actualCost || 0);
      
      if (remainingBlocked > 0) {
        const user = await User.findById(campaign.userId);
        if (user) {
          await user.unblockBalance(remainingBlocked);
          console.log(`✅ Campaign: ${campaign.name}`);
          console.log(`   Blocked: ₹${campaign.blockedAmount}, Actual: ₹${campaign.actualCost}`);
          console.log(`   Unblocked: ₹${remainingBlocked}\n`);
        }
      }
    }

    // Find all users with blocked balance
    const usersWithBlocked = await User.find({
      'wallet.blockedBalance': { $gt: 0 }
    }).select('name wallet.balance wallet.blockedBalance');

    console.log('\n📊 Users with blocked balance:');
    usersWithBlocked.forEach(user => {
      console.log(`  ${user.name}: Balance=₹${user.wallet.balance}, Blocked=₹${user.wallet.blockedBalance}, Available=₹${user.wallet.balance - user.wallet.blockedBalance}`);
    });

    console.log('\n✅ Cleanup completed!');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  }
}

cleanupBlockedBalance();
