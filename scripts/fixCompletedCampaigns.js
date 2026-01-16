import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../src/models/user.model.js';
import Campaign from '../src/models/campaign.model.js';

dotenv.config();

async function fixCompletedCampaigns() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const completedWithBlocked = await Campaign.find({
    status: 'completed',
    blockedAmount: { $gt: 0 }
  });
  
  console.log(`Found ${completedWithBlocked.length} completed campaigns with blocked amounts\n`);
  
  for (const campaign of completedWithBlocked) {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      const user = await User.findById(campaign.userId).session(session);
      
      console.log(`Fixing campaign ${campaign._id.toString().slice(-6)}:`);
      console.log(`  Blocked amount: ₹${campaign.blockedAmount}`);
      console.log(`  User blocked balance before: ₹${user.wallet.blockedBalance}`);
      
      // Unblock the amount from user wallet
      await User.findByIdAndUpdate(
        campaign.userId,
        {
          $inc: { 'wallet.blockedBalance': -campaign.blockedAmount },
          $set: { 'wallet.lastUpdated': new Date() }
        },
        { session }
      );
      
      // Clear blocked amount from campaign
      campaign.blockedAmount = 0;
      await campaign.save({ session });
      
      await session.commitTransaction();
      
      const updatedUser = await User.findById(campaign.userId);
      console.log(`  User blocked balance after: ₹${updatedUser.wallet.blockedBalance}`);
      console.log(`  ✅ Fixed\n`);
    } catch (error) {
      await session.abortTransaction();
      console.error(`  ❌ Error:`, error.message);
    } finally {
      session.endSession();
    }
  }
  
  const user = await User.findOne({ email: 'largemedia@gmail.com' });
  console.log('\nFinal User Wallet:', {
    balance: user.wallet.balance,
    blockedBalance: user.wallet.blockedBalance,
    available: user.wallet.balance - user.wallet.blockedBalance
  });
  
  await mongoose.disconnect();
}

fixCompletedCampaigns().catch(console.error);
