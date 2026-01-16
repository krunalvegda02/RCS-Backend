import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../.env') });

async function fixWalletBalance() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const User = (await import('../models/user.model.js')).default;
    const ContactCampaignMessage = (await import('../models/contact_campaign_message.model.js')).default;

    const users = await User.find({ role: 'USER' });
    
    for (const user of users) {
      console.log(`\n👤 User: ${user.companyname || user.email}`);
      console.log(`   Current balance: ₹${user.wallet.balance}`);
      
      // Calculate total delivered messages
      const stats = await ContactCampaignMessage.aggregate([
        { $match: { userId: user._id } },
        { $unwind: '$campaigns' },
        {
          $group: {
            _id: null,
            totalDelivered: {
              $sum: {
                $cond: [{ $in: ['$campaigns.status', ['delivered', 'read', 'replied']] }, 1, 0]
              }
            }
          }
        }
      ]);
      
      const totalDelivered = stats[0]?.totalDelivered || 0;
      const totalCharged = totalDelivered * 1; // ₹1 per delivered
      
      // Assuming starting balance was ₹100,000
      const correctBalance = 100000 - totalCharged;
      
      console.log(`   Total delivered: ${totalDelivered}`);
      console.log(`   Total charged: ₹${totalCharged}`);
      console.log(`   Correct balance: ₹${correctBalance}`);
      
      if (user.wallet.balance !== correctBalance) {
        const difference = correctBalance - user.wallet.balance;
        console.log(`   ⚠️  Difference: ₹${difference}`);
        
        user.wallet.balance = correctBalance;
        user.wallet.blockedBalance = 0;
        user.wallet.lastUpdated = new Date();
        user.wallet.transactions.push({
          type: difference > 0 ? 'credit' : 'debit',
          amount: Math.abs(difference),
          balanceAfter: correctBalance,
          description: `Balance correction: Adjusted by ₹${difference} to reflect ${totalDelivered} delivered messages`,
          createdAt: new Date()
        });
        
        await user.save();
        console.log(`   ✅ Balance corrected to ₹${correctBalance}`);
      } else {
        console.log(`   ✅ Balance is correct`);
      }
    }
    
    console.log('\n✅ All wallets fixed');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Disconnected');
    process.exit(0);
  }
}

fixWalletBalance();
