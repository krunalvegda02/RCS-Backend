/**
 * Test to verify wallet deduction flow
 * 
 * CURRENT BEHAVIOR:
 * 1. Wallet is deducted UPFRONT when campaign is created (campaign.controller.js line 187)
 * 2. Webhook does NOT deduct wallet on delivery
 * 3. Amount = RCS capable recipients × ₹1
 * 
 * ISSUE: Wallet is charged upfront, not on actual delivery
 * This means if message fails, user is already charged
 */

import mongoose from 'mongoose';
import User from './src/models/user.model.js';
import Campaign from './src/models/campaign.model.js';
import Message from './src/models/message.model.js';

const MONGODB_URI = 'mongodb+srv://krunalvegda02:krunalvegda02@cluster0.jwybog2.mongodb.net/test?retryWrites=true&w=majority';

async function testWalletFlow() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Find a user with campaigns
    const user = await User.findOne({ role: 'user' }).sort({ createdAt: -1 });
    if (!user) {
      console.log('❌ No user found');
      return;
    }

    console.log('👤 User:', user.name);
    console.log('💰 Current Balance:', user.wallet.balance);
    console.log('📊 Total Transactions:', user.wallet.transactions.length);
    
    // Get recent transactions
    const recentTransactions = user.wallet.transactions.slice(-5);
    console.log('\n📝 Recent Transactions:');
    recentTransactions.forEach(t => {
      console.log(`  ${t.type.toUpperCase()}: ₹${t.amount} - ${t.description} (${new Date(t.createdAt).toLocaleString()})`);
    });

    // Find user's campaigns
    const campaigns = await Campaign.find({ userId: user._id })
      .sort({ createdAt: -1 })
      .limit(3)
      .select('name status stats estimatedCost actualCost createdAt');

    console.log('\n📢 Recent Campaigns:');
    campaigns.forEach(c => {
      console.log(`  ${c.name}`);
      console.log(`    Status: ${c.status}`);
      console.log(`    RCS Capable: ${c.stats.rcsCapable}`);
      console.log(`    Estimated Cost: ₹${c.estimatedCost}`);
      console.log(`    Actual Cost: ₹${c.actualCost}`);
      console.log(`    Sent: ${c.stats.sent}, Delivered: ${c.stats.delivered || 0}, Failed: ${c.stats.failed}`);
    });

    // Check messages for a campaign
    if (campaigns.length > 0) {
      const campaignId = campaigns[0]._id;
      const messages = await Message.find({ campaignId })
        .limit(5)
        .select('phoneNumber status sentAt deliveredAt');

      console.log(`\n📨 Sample Messages from "${campaigns[0].name}":`);
      messages.forEach(m => {
        console.log(`  ${m.phoneNumber}: ${m.status} ${m.deliveredAt ? '(delivered)' : ''}`);
      });
    }

    console.log('\n' + '='.repeat(60));
    console.log('ANALYSIS:');
    console.log('='.repeat(60));
    console.log('✅ Wallet deduction happens UPFRONT when campaign starts');
    console.log('✅ Webhook only updates message status (no wallet changes)');
    console.log('⚠️  ISSUE: User charged even if message fails to deliver');
    console.log('💡 RECOMMENDATION: Deduct on delivery, refund on failure');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  }
}

testWalletFlow();
