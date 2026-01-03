// Manual cleanup script for stuck blocked balances
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const userSchema = new mongoose.Schema({
  wallet: {
    balance: Number,
    blockedBalance: Number,
  }
}, { collection: 'users' });

const User = mongoose.model('User', userSchema);

async function cleanupAllBlockedBalances() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const users = await User.find({ 'wallet.blockedBalance': { $gt: 0 } });
    console.log(`Found ${users.length} users with blocked balance`);

    for (const user of users) {
      const blockedAmount = user.wallet.blockedBalance;
      console.log(`User ${user._id}: Blocked ₹${blockedAmount}`);
      
      // Unblock all
      user.wallet.blockedBalance = 0;
      await user.save();
      
      console.log(`✅ Unblocked ₹${blockedAmount} for user ${user._id}`);
    }

    console.log('Cleanup completed!');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

cleanupAllBlockedBalances();
