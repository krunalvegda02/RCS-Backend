import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function fixWalletBalance() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const db = mongoose.connection.db;
    const users = db.collection('users');

    // Find users with string balance
    const usersWithStringBalance = await users.find({
      'wallet.balance': { $type: 'string' }
    }).toArray();

    console.log(`Found ${usersWithStringBalance.length} users with string balance\n`);

    for (const user of usersWithStringBalance) {
      const balance = parseFloat(user.wallet.balance) || 0;
      const blockedBalance = parseFloat(user.wallet.blockedBalance) || 0;

      await users.updateOne(
        { _id: user._id },
        {
          $set: {
            'wallet.balance': balance,
            'wallet.blockedBalance': blockedBalance
          }
        }
      );

      console.log(`Fixed user ${user._id}: balance=${balance}, blocked=${blockedBalance}`);
    }

    console.log('\n✅ Done');
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

fixWalletBalance();
