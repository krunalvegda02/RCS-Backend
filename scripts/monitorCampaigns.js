import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../src/models/user.model.js';
import Campaign from '../src/models/campaign.model.js';
import ContactCampaignMessage from '../src/models/contact_campaign_message.model.js';

dotenv.config();

async function monitorCampaigns() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const user = await User.findOne({ email: 'largemedia@gmail.com' });
  console.log('👤 User Wallet:', {
    balance: user.wallet.balance,
    blockedBalance: user.wallet.blockedBalance,
    available: user.wallet.balance - user.wallet.blockedBalance
  });
  
  const campaigns = await Campaign.find({ userId: user._id })
    .sort({ createdAt: -1 })
    .limit(5);
  
  console.log('\n📊 Recent Campaigns:\n');
  
  for (const campaign of campaigns) {
    const stats = await ContactCampaignMessage.aggregate([
      { $match: { userId: campaign.userId } },
      { $unwind: '$campaigns' },
      { $match: { 'campaigns.campaignId': campaign._id } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          pending: { $sum: { $cond: [{ $in: ['$campaigns.status', ['draft', 'queued', 'pending', 'sent']] }, 1, 0] } },
          delivered: { $sum: { $cond: [{ $in: ['$campaigns.status', ['delivered', 'read', 'replied']] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$campaigns.status', 'failed'] }, 1, 0] } }
        }
      }
    ]);
    
    const { total = 0, pending = 0, delivered = 0, failed = 0 } = stats[0] || {};
    const shouldComplete = total > 0 && pending === 0 && campaign.status !== 'completed';
    
    console.log(`Campaign ${campaign._id.toString().slice(-6)}:`);
    console.log(`  Status: ${campaign.status}`);
    console.log(`  Messages: ${total} total, ${pending} pending, ${delivered} delivered, ${failed} failed`);
    console.log(`  Blocked: ₹${campaign.blockedAmount}, Actual: ₹${campaign.actualCost}`);
    console.log(`  Should Complete: ${shouldComplete ? '⚠️  YES' : '✅ No'}`);
    console.log('');
  }
  
  await mongoose.disconnect();
}

monitorCampaigns().catch(console.error);
