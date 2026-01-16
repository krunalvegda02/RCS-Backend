import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../src/models/user.model.js';
import Campaign from '../src/models/campaign.model.js';

dotenv.config();

async function checkBlockedBalance() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const user = await User.findOne({ email: 'largemedia@gmail.com' });
  console.log('User Wallet:', {
    balance: user.wallet.balance,
    blockedBalance: user.wallet.blockedBalance,
    available: user.wallet.balance - user.wallet.blockedBalance
  });
  
  const campaigns = await Campaign.find({ userId: user._id })
    .sort({ createdAt: -1 })
    .limit(10)
    .select('status totalMessages delivered failed expired pending blockedAmount createdAt');
  
  console.log('\nRecent Campaigns:');
  let totalBlocked = 0;
  campaigns.forEach(c => {
    if (c.blockedAmount > 0) totalBlocked += c.blockedAmount;
    console.log({
      id: c._id.toString().slice(-6),
      status: c.status,
      total: c.totalMessages,
      delivered: c.delivered,
      failed: c.failed,
      expired: c.expired,
      pending: c.pending,
      blockedAmount: c.blockedAmount,
      shouldComplete: c.totalMessages > 0 && c.pending === 0 && c.status !== 'completed'
    });
  });
  
  console.log('\nTotal blocked in campaigns:', totalBlocked);
  console.log('User blocked balance:', user.wallet.blockedBalance);
  console.log('Match:', totalBlocked === user.wallet.blockedBalance);
  
  await mongoose.disconnect();
}

checkBlockedBalance().catch(console.error);
