import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from '../src/db/index.js';

dotenv.config();

async function fixNegativeBlockedBalance() {
  try {
    await connectDB();
    console.log('🔄 Fixing negative blocked balances...');
    
    const User = (await import('../src/models/user.model.js')).default;
    
    // Find users with negative blocked balance
    const users = await User.find({ 'wallet.blockedBalance': { $lt: 0 } });
    
    console.log(`Found ${users.length} users with negative blocked balance`);
    
    for (const user of users) {
      console.log(`\n[User ${user._id}] ${user.name}`);
      console.log(`  Email: ${user.email}`);
      console.log(`  Balance: ₹${user.wallet.balance}`);
      console.log(`  Blocked: ₹${user.wallet.blockedBalance}`);
      
      // Reset blocked balance to 0
      user.wallet.blockedBalance = 0;
      user.wallet.lastUpdated = new Date();
      await user.save();
      
      console.log(`  ✅ Fixed! Blocked balance reset to 0`);
    }
    
    console.log('\n✅ Done!');
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

fixNegativeBlockedBalance();
