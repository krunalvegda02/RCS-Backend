import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../.env') });

async function testWalletFlow() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected\n');

    const User = (await import('../models/user.model.js')).default;
    const Campaign = (await import('../models/campaign.model.js')).default;
    const ContactCampaignMessage = (await import('../models/contact_campaign_message.model.js')).default;

    // Find a test user
    const user = await User.findOne({ role: 'USER' });
    if (!user) {
      console.log('❌ No user found');
      return;
    }

    console.log(`👤 Testing with: ${user.companyname || user.email}`);
    console.log(`💰 Initial Balance: ₹${user.wallet.balance}`);
    console.log(`🔒 Initial Blocked: ₹${user.wallet.blockedBalance}\n`);

    // Create test campaign
    const testCampaign = await Campaign.create({
      name: 'Wallet Test Campaign',
      botId: 'bot1',
      userId: user._id,
      templateId: new mongoose.Types.ObjectId(),
      status: 'running',
      estimatedCost: 10,
      blockedAmount: 10
    });

    console.log(`📝 Created campaign: ${testCampaign._id}`);
    
    // Block wallet
    await user.blockBalanceForCampaign(10, testCampaign._id);
    await user.save();
    
    const afterBlock = await User.findById(user._id);
    console.log(`\n💰 After blocking ₹10:`);
    console.log(`   Balance: ₹${afterBlock.wallet.balance}`);
    console.log(`   Blocked: ₹${afterBlock.wallet.blockedBalance}`);
    console.log(`   Available: ₹${afterBlock.wallet.balance - afterBlock.wallet.blockedBalance}`);

    // Create test messages
    const messages = [];
    for (let i = 0; i < 10; i++) {
      messages.push({
        recipientPhoneNumber: `900000000${i}`,
        userId: user._id,
        campaignIds: [testCampaign._id],
        campaigns: [{
          campaignId: testCampaign._id,
          templateId: new mongoose.Types.ObjectId(),
          messageId: `test-msg-${i}`,
          status: i < 5 ? 'delivered' : i < 8 ? 'failed' : 'pending',
          cost: 1
        }]
      });
    }

    await ContactCampaignMessage.insertMany(messages);
    console.log(`\n📨 Created 10 test messages:`);
    console.log(`   5 delivered, 3 failed, 2 expired`);

    // Complete campaign
    console.log(`\n🎯 Completing campaign...`);
    const result = await testCampaign.completeCampaign();

    const afterComplete = await User.findById(user._id);
    console.log(`\n✅ Campaign completed:`);
    console.log(`   Delivered: ${result.delivered}`);
    console.log(`   Failed: ${result.failed}`);
    console.log(`   Expired: ${result.expired}`);
    console.log(`   Actual Cost: ₹${result.actualCost}`);
    console.log(`   Refund: ₹${result.refundAmount}`);

    console.log(`\n💰 Final Wallet:`);
    console.log(`   Balance: ₹${afterComplete.wallet.balance}`);
    console.log(`   Blocked: ₹${afterComplete.wallet.blockedBalance}`);
    console.log(`   Available: ₹${afterComplete.wallet.balance - afterComplete.wallet.blockedBalance}`);

    // Verify correctness
    const expectedBalance = user.wallet.balance - result.actualCost;
    const isCorrect = afterComplete.wallet.balance === expectedBalance && 
                      afterComplete.wallet.blockedBalance === 0;

    console.log(`\n${isCorrect ? '✅' : '❌'} Verification:`);
    console.log(`   Expected Balance: ₹${expectedBalance}`);
    console.log(`   Actual Balance: ₹${afterComplete.wallet.balance}`);
    console.log(`   Match: ${isCorrect ? 'YES' : 'NO'}`);

    // Cleanup
    console.log(`\n🧹 Cleaning up test data...`);
    await Campaign.findByIdAndDelete(testCampaign._id);
    await ContactCampaignMessage.deleteMany({ 
      recipientPhoneNumber: { $regex: /^900000000/ } 
    });
    
    // Restore wallet
    await User.findByIdAndUpdate(user._id, {
      $set: {
        'wallet.balance': user.wallet.balance,
        'wallet.blockedBalance': user.wallet.blockedBalance
      }
    });

    console.log(`✅ Test completed and cleaned up`);

  } catch (error) {
    console.error('❌ Test error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Disconnected');
    process.exit(0);
  }
}

testWalletFlow();
