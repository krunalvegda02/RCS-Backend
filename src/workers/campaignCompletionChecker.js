import mongoose from 'mongoose';
import connectDB from '../db/index.js';
import Campaign from '../models/campaign.model.js';
import ContactCampaignMessage from '../models/contact_campaign_message.model.js';

process.env.WORKER_MODE = 'true';

async function checkCampaignCompletion() {
  try {
    await connectDB();
    console.log('✅ Campaign Completion Checker connected to MongoDB');
    
    // Check every 30 seconds
    setInterval(async () => {
      try {
        // Find all running campaigns
        const runningCampaigns = await Campaign.find({ status: 'running' }).lean();
        
        if (runningCampaigns.length === 0) return;
        
        console.log(`[Completion] Checking ${runningCampaigns.length} running campaigns`);
        
        for (const campaign of runningCampaigns) {
          // Count messages by status
          const statusCounts = await ContactCampaignMessage.aggregate([
            { 
              $match: { 
                userId: campaign.userId,
                'campaigns.campaignId': campaign._id 
              } 
            },
            { $unwind: '$campaigns' },
            { $match: { 'campaigns.campaignId': campaign._id } },
            {
              $group: {
                _id: '$campaigns.status',
                count: { $sum: 1 }
              }
            }
          ]);
          
          const statusMap = {};
          let total = 0;
          statusCounts.forEach(s => {
            statusMap[s._id] = s.count;
            total += s.count;
          });
          
          const queued = statusMap.queued || 0;
          const draft = statusMap.draft || 0;
          const processing = statusMap.processing || 0;
          const sent = statusMap.sent || 0;
          const delivered = statusMap.delivered || 0;
          const read = statusMap.read || 0;
          const replied = statusMap.replied || 0;
          const failed = statusMap.failed || 0;
          
          // Campaign is complete when no messages are in draft/queued/processing
          const isComplete = (queued + draft + processing) === 0 && total > 0;
          
          if (isComplete) {
            console.log(`[Completion] ✅ Campaign ${campaign._id} completed: ${sent + delivered + read + replied} sent, ${failed} failed`);
            
            await Campaign.updateOne(
              { _id: campaign._id },
              {
                status: 'completed',
                completedAt: new Date(),
                'stats.total': total,
                'stats.sent': sent + delivered + read + replied,
                'stats.delivered': delivered + read + replied,
                'stats.read': read + replied,
                'stats.replied': replied,
                'stats.failed': failed
              }
            );
          } else {
            console.log(`[Completion] Campaign ${campaign._id}: ${queued} queued, ${processing} processing, ${draft} draft`);
          }
        }
      } catch (error) {
        console.error('[Completion] Check error:', error.message);
      }
    }, 30000); // Check every 30 seconds
    
  } catch (error) {
    console.error('❌ Campaign completion checker startup failed:', error);
    process.exit(1);
  }
}

checkCampaignCompletion();
