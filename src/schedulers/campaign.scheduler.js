import cron from 'node-cron';
import Campaign from '../models/campaign.model.js';
import ContactBatch from '../models/contactBatch.model.js';

// Delete archived campaigns at midnight (00:00) every day
export const scheduleArchivedCampaignCleanup = () => {
  cron.schedule('0 0 * * *', async () => {
    try {
      console.log('[Scheduler] Starting archived campaign cleanup...');
      
      // Find all archived campaigns
      const archivedCampaigns = await Campaign.find({ isArchived: true }).select('_id name');
      
      if (archivedCampaigns.length === 0) {
        console.log('[Scheduler] No archived campaigns to delete');
        return;
      }

      const campaignIds = archivedCampaigns.map(c => c._id);
      
      // Delete associated contact batches
      const batchDeleteResult = await ContactBatch.deleteMany({ 
        campaignId: { $in: campaignIds } 
      });
      
      // Delete archived campaigns
      const campaignDeleteResult = await Campaign.deleteMany({ 
        isArchived: true 
      });
      
      console.log(`[Scheduler] Cleanup completed: Deleted ${campaignDeleteResult.deletedCount} campaigns and ${batchDeleteResult.deletedCount} contact batches`);
    } catch (error) {
      console.error('[Scheduler] Archived campaign cleanup failed:', error);
    }
  });
  
  console.log('[Scheduler] Archived campaign cleanup scheduled for midnight (00:00) daily');
};
