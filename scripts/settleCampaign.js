import mongoose from 'mongoose';
import connectDB from '../src/db/index.js';

async function settleCampaign() {
  try {
    // Get campaign ID from command line argument
    const campaignId = process.argv[2];

    if (!campaignId) {
      console.error('❌ Usage: node scripts/settleCampaign.js <campaignId>');
      process.exit(1);
    }

    await connectDB();
    console.log('✅ MongoDB connected');

    const Campaign = (await import('../src/models/campaign.model.js')).default;
    const User = (await import('../src/models/user.model.js')).default;

    // Find campaign
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      console.error(`❌ Campaign ${campaignId} not found`);
      process.exit(1);
    }

    console.log('\n📊 Campaign Details:');
    console.log(`   Name: ${campaign.name}`);
    console.log(`   Status: ${campaign.status}`);
    console.log(`   Blocked Amount: ₹${campaign.blockedAmount}`);
    console.log(`   Estimated Cost: ₹${campaign.estimatedCost}`);

    // Get user wallet before
    const user = await User.findById(campaign.userId);
    console.log('\n💰 User Wallet BEFORE:');
    console.log(`   Balance: ₹${user.wallet.balance}`);
    console.log(`   Blocked: ₹${user.wallet.blockedBalance}`);
    console.log(`   Available: ₹${user.getAvailableBalance()}`);

    // Settle campaign
    console.log('\n🔄 Starting settlement...\n');
    const result = await campaign.completeCampaign();

    // Get user wallet after
    const updatedUser = await User.findById(campaign.userId);
    console.log('\n💰 User Wallet AFTER:');
    console.log(`   Balance: ₹${updatedUser.wallet.balance}`);
    console.log(`   Blocked: ₹${updatedUser.wallet.blockedBalance}`);
    console.log(`   Available: ₹${updatedUser.getAvailableBalance()}`);

    console.log('\n📈 Settlement Summary:');
    console.log(`   Delivered: ${result.delivered}`);
    console.log(`   Failed: ${result.failed}`);
    console.log(`   Actual Cost: ₹${result.actualCost}`);
    console.log(`   Refund: ₹${result.refundAmount}`);

    console.log('\n✅ Settlement completed successfully!');

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

settleCampaign();
