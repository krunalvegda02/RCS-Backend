import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from '../src/db/index.js';

dotenv.config();

async function debugLastCampaign() {
  try {
    await connectDB();
    
    const User = (await import('../src/models/user.model.js')).default;
    const Campaign = (await import('../src/models/campaign.model.js')).default;
    const ContactCampaignMessage = (await import('../src/models/contact_campaign_message.model.js')).default;
    
    // Get user
    const user = await User.findOne({ email: 'largemedia@gmail.com' });
    
    console.log('\n========== USER WALLET ==========');
    console.log(`Name: ${user.name}`);
    console.log(`Email: ${user.email}`);
    console.log(`Balance: ₹${user.wallet.balance}`);
    console.log(`Blocked: ₹${user.wallet.blockedBalance}`);
    console.log(`Available: ₹${user.wallet.balance - user.wallet.blockedBalance}`);
    
    // Get last campaign
    const lastCampaign = await Campaign.findOne({ userId: user._id }).sort({ createdAt: -1 });
    
    if (!lastCampaign) {
      console.log('\nNo campaigns found');
      await mongoose.connection.close();
      process.exit(0);
    }
    
    console.log('\n========== LAST CAMPAIGN ==========');
    console.log(`ID: ${lastCampaign._id}`);
    console.log(`Name: ${lastCampaign.name}`);
    console.log(`Status: ${lastCampaign.status}`);
    console.log(`Created: ${lastCampaign.createdAt}`);
    console.log(`Estimated Cost: ₹${lastCampaign.estimatedCost}`);
    console.log(`Blocked Amount: ₹${lastCampaign.blockedAmount}`);
    console.log(`Actual Cost: ₹${lastCampaign.actualCost || 0}`);
    console.log(`Refunded: ₹${lastCampaign.refundedAmount || 0}`);
    
    // Get message stats
    console.log('\n========== MESSAGE STATS ==========');
    const stats = await ContactCampaignMessage.aggregate([
      { $match: { userId: user._id } },
      { $unwind: '$campaigns' },
      { $match: { 'campaigns.campaignId': lastCampaign._id } },
      {
        $group: {
          _id: '$campaigns.status',
          count: { $sum: 1 }
        }
      }
    ]);
    
    let total = 0;
    let pending = 0;
    let delivered = 0;
    let failed = 0;
    let sent = 0;
    let expired = 0;
    
    stats.forEach(s => {
      total += s.count;
      console.log(`${s._id}: ${s.count}`);
      
      if (['draft', 'queued', 'pending'].includes(s._id)) pending += s.count;
      if (['delivered', 'read', 'replied'].includes(s._id)) delivered += s.count;
      if (s._id === 'failed') failed += s.count;
      if (s._id === 'sent') sent += s.count;
      if (s._id === 'expired') expired += s.count;
    });
    
    console.log(`\nTotal: ${total}`);
    console.log(`Pending: ${pending}`);
    console.log(`Sent: ${sent}`);
    console.log(`Delivered: ${delivered}`);
    console.log(`Failed: ${failed}`);
    console.log(`Expired: ${expired}`);
    
    // Check completion criteria
    console.log('\n========== COMPLETION CHECK ==========');
    console.log(`Should complete? ${pending === 0 && total > 0 ? 'YES ✅' : 'NO ❌'}`);
    console.log(`Reason: ${pending > 0 ? `${pending} messages still pending` : 'All messages processed'}`);
    
    // Check if stats consumer would complete it
    if (pending === 0 && total > 0 && lastCampaign.status !== 'completed') {
      console.log('\n⚠️  Campaign should be completed but is not!');
      console.log('🔧 Completing now...');
      
      await lastCampaign.completeCampaign();
      
      console.log('✅ Campaign completed!');
      
      // Refresh user
      const updatedUser = await User.findById(user._id);
      console.log('\n========== UPDATED WALLET ==========');
      console.log(`Balance: ₹${updatedUser.wallet.balance}`);
      console.log(`Blocked: ₹${updatedUser.wallet.blockedBalance}`);
      console.log(`Available: ₹${updatedUser.wallet.balance - updatedUser.wallet.blockedBalance}`);
    } else if (lastCampaign.status === 'completed') {
      console.log('\n✅ Campaign already completed');
      
      if (lastCampaign.blockedAmount > 0) {
        console.log('⚠️  But blockedAmount is not cleared!');
        console.log('🔧 Clearing now...');
        
        lastCampaign.blockedAmount = 0;
        await lastCampaign.save();
        
        user.wallet.blockedBalance = Math.max(0, user.wallet.blockedBalance - lastCampaign.blockedAmount);
        await user.save();
        
        console.log('✅ Fixed!');
      }
    }
    
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

debugLastCampaign();
