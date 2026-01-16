import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Campaign from '../src/models/campaign.model.js';
import ContactCampaignMessage from '../src/models/contact_campaign_message.model.js';

dotenv.config();

async function autoCleanupCampaigns() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('[AutoCleanup] Starting campaign cleanup...');
    
    // Find campaigns that should be completed
    const stuckCampaigns = await Campaign.find({
      status: { $in: ['running', 'processing'] },
      createdAt: { $lt: new Date(Date.now() - 10 * 60 * 1000) } // Older than 10 minutes
    });
    
    console.log(`[AutoCleanup] Found ${stuckCampaigns.length} potentially stuck campaigns`);
    
    for (const campaign of stuckCampaigns) {
      try {
        // Check message stats
        const stats = await ContactCampaignMessage.aggregate([
          { $match: { userId: campaign.userId } },
          { $unwind: '$campaigns' },
          { $match: { 'campaigns.campaignId': campaign._id } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              pending: { 
                $sum: { 
                  $cond: [
                    { $in: ['$campaigns.status', ['draft', 'queued', 'pending', 'sent']] }, 
                    1, 
                    0 
                  ] 
                } 
              }
            }
          }
        ]);
        
        const { total = 0, pending = 0 } = stats[0] || {};
        
        if (total > 0 && pending === 0) {
          console.log(`[AutoCleanup] Completing campaign ${campaign._id.toString().slice(-6)}`);
          await campaign.completeCampaign();
          console.log(`[AutoCleanup] ✅ Completed`);
        } else {
          console.log(`[AutoCleanup] Campaign ${campaign._id.toString().slice(-6)}: ${pending}/${total} still pending`);
        }
      } catch (error) {
        console.error(`[AutoCleanup] Error processing campaign ${campaign._id}:`, error.message);
      }
    }
    
    // Also fix completed campaigns with blocked amounts
    const completedWithBlocked = await Campaign.find({
      status: 'completed',
      blockedAmount: { $gt: 0 }
    });
    
    if (completedWithBlocked.length > 0) {
      console.log(`[AutoCleanup] Found ${completedWithBlocked.length} completed campaigns with blocked amounts`);
      
      for (const campaign of completedWithBlocked) {
        try {
          console.log(`[AutoCleanup] Re-completing campaign ${campaign._id.toString().slice(-6)}`);
          await campaign.completeCampaign();
          console.log(`[AutoCleanup] ✅ Fixed`);
        } catch (error) {
          console.error(`[AutoCleanup] Error fixing campaign ${campaign._id}:`, error.message);
        }
      }
    }
    
    console.log('[AutoCleanup] Cleanup complete');
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('[AutoCleanup] Fatal error:', error);
    process.exit(1);
  }
}

autoCleanupCampaigns();
