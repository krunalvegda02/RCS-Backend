import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from '../src/db/index.js';

dotenv.config();

async function recalculateCampaignStats() {
  try {
    await connectDB();
    console.log('🔄 Recalculating campaign stats...\n');
    
    const Campaign = (await import('../src/models/campaign.model.js')).default;
    const ContactCampaignMessage = (await import('../src/models/contact_campaign_message.model.js')).default;
    
    // Get campaign ID from command line or use the one from your example
    const campaignId = process.argv[2] || '696dea247baec48d52c40de7';
    
    console.log(`Campaign ID: ${campaignId}\n`);
    
    // Get campaign
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      console.log('❌ Campaign not found');
      process.exit(1);
    }
    
    console.log(`Campaign: ${campaign.name}`);
    console.log(`Status: ${campaign.status}`);
    console.log(`\nCurrent Stats:`);
    console.log(`  Total: ${campaign.stats.total}`);
    console.log(`  Sent: ${campaign.stats.sent}`);
    console.log(`  Delivered: ${campaign.stats.delivered}`);
    console.log(`  Failed: ${campaign.stats.failed}`);
    console.log(`  Read: ${campaign.stats.read}`);
    console.log(`  Replied: ${campaign.stats.replied}`);
    
    // Calculate actual stats from messages
    const stats = await ContactCampaignMessage.aggregate([
      { $match: { userId: campaign.userId } },
      { $unwind: '$campaigns' },
      { $match: { 'campaigns.campaignId': campaign._id } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          draft: { $sum: { $cond: [{ $eq: ['$campaigns.status', 'draft'] }, 1, 0] } },
          queued: { $sum: { $cond: [{ $eq: ['$campaigns.status', 'queued'] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ['$campaigns.status', 'pending'] }, 1, 0] } },
          sent: { $sum: { $cond: [{ $eq: ['$campaigns.status', 'sent'] }, 1, 0] } },
          delivered: { $sum: { $cond: [{ $eq: ['$campaigns.status', 'delivered'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$campaigns.status', 'failed'] }, 1, 0] } },
          read: { $sum: { $cond: [{ $eq: ['$campaigns.status', 'read'] }, 1, 0] } },
          replied: { $sum: { $cond: [{ $eq: ['$campaigns.status', 'replied'] }, 1, 0] } }
        }
      }
    ]);
    
    const actualStats = stats[0] || {};
    
    console.log(`\nActual Stats from Messages:`);
    console.log(`  Total: ${actualStats.total || 0}`);
    console.log(`  Draft: ${actualStats.draft || 0}`);
    console.log(`  Queued: ${actualStats.queued || 0}`);
    console.log(`  Pending: ${actualStats.pending || 0}`);
    console.log(`  Sent: ${actualStats.sent || 0}`);
    console.log(`  Delivered: ${actualStats.delivered || 0}`);
    console.log(`  Failed: ${actualStats.failed || 0}`);
    console.log(`  Read: ${actualStats.read || 0}`);
    console.log(`  Replied: ${actualStats.replied || 0}`);
    
    // Update campaign stats
    campaign.stats = {
      total: actualStats.total || 0,
      sent: actualStats.sent || 0,
      delivered: actualStats.delivered || 0,
      failed: actualStats.failed || 0,
      read: actualStats.read || 0,
      replied: actualStats.replied || 0,
      bounced: 0
    };
    
    await campaign.save();
    
    console.log(`\n✅ Campaign stats updated!`);
    
    // If campaign is completed, recalculate costs
    if (campaign.status === 'completed') {
      const deliveredCount = (actualStats.delivered || 0) + (actualStats.read || 0) + (actualStats.replied || 0);
      const actualCost = deliveredCount * 1; // ₹1 per delivered
      
      console.log(`\nCost Calculation:`);
      console.log(`  Delivered messages: ${deliveredCount}`);
      console.log(`  Actual cost: ₹${actualCost}`);
      console.log(`  Blocked amount: ₹${campaign.blockedAmount}`);
      
      if (campaign.blockedAmount > 0) {
        console.log(`\n⚠️  Campaign has blocked amount. Run completeCampaign to settle wallet.`);
      }
    }
    
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

recalculateCampaignStats();
