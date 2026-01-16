  import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../src/models/user.model.js';
import Campaign from '../src/models/campaign.model.js';

dotenv.config();

async function findAllBlocked() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const user = await User.findOne({ email: 'largemedia@gmail.com' });
  console.log('User blocked balance:', user.wallet.blockedBalance);
  
  const allCampaigns = await Campaign.find({ 
    userId: user._id,
    blockedAmount: { $gt: 0 }
  }).select('_id name status blockedAmount createdAt');
  
  console.log(`\nFound ${allCampaigns.length} campaigns with blocked amounts:\n`);
  
  let total = 0;
  allCampaigns.forEach(c => {
    console.log({
      id: c._id.toString().slice(-6),
      name: c.name,
      status: c.status,
      blocked: c.blockedAmount,
      created: c.createdAt
    });
    total += c.blockedAmount;
  });
  
  console.log('\nTotal blocked in campaigns:', total);
  console.log('User blocked balance:', user.wallet.blockedBalance);
  console.log('Difference:', user.wallet.blockedBalance - total);
  
  await mongoose.disconnect();
}

findAllBlocked().catch(console.error);
