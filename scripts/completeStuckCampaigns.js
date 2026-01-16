import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from '../src/db/index.js';

// Load environment variables
dotenv.config();

async function completeStuckCampaigns() {
  try {
    await connectDB();
    console.log('🔄 Checking for stuck campaigns...');
    
    const Campaign = (await import('../src/models/campaign.model.js')).default;
    const ContactCampaignMessage = (await import('../src/models/contact_campaign_message.model.js')).default;
    
    // Find all non-completed campaigns
    const campaigns = await Campaign.find({ 
      status: { $ne: 'completed' },
      blockedAmount: { $gt: 0 }
    });
    
    console.log(`Found ${campaigns.length} non-completed campaigns with blocked balance`);
    
    for (const campaign of campaigns) {
      try {
        console.log(`\n[Campaign ${campaign._id}] ${campaign.name}`);
        console.log(`  Status: ${campaign.status}`);
        console.log(`  Blocked: ₹${campaign.blockedAmount}`);
        
        // Check message stats
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
              failed: { $sum: { $cond: [{ $eq: ['$campaigns.status', 'failed'] }, 1, 0] } },
              expired: { $sum: { $cond: [{ $eq: ['$campaigns.status', 'expired'] }, 1, 0] } }
            }
          }
        ]);
        
        const { total = 0, pending = 0, delivered = 0, failed = 0, expired = 0 } = stats[0] || {};
        const processed = delivered + failed + expired;
        
        console.log(`  Messages: ${total} total, ${pending} pending, ${processed} processed`);
        console.log(`  Breakdown: ${delivered} delivered, ${failed} failed, ${expired} expired`);
        
        // Complete if all messages are processed
        if (total > 0 && pending === 0 && processed >= total) {
          console.log(`  ✅ Completing campaign...`);
          const result = await campaign.completeCampaign();
          console.log(`  💰 Actual cost: ₹${result.actualCost}, Refund: ₹${result.refundAmount}`);
        } else {
          console.log(`  ⏳ Not ready: ${pending} messages still pending`);
        }
      } catch (error) {
        console.error(`  ❌ Error:`, error.message);
      }
    }
    
    console.log('\n✅ Done!');
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

completeStuckCampaigns();
