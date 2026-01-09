import Campaign from '../models/campaign.model.js';

// Auto-sync campaign stats after message status updates
export const autoSyncCampaignStats = async (campaignId) => {
  try {
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) return;
    
    await campaign.syncStats();
    console.log(`[AutoSync] Stats synced for campaign ${campaignId}`);
  } catch (error) {
    console.error('[AutoSync] Error:', error.message);
  }
};

// Batch sync multiple campaigns (for webhooks)
export const batchSyncCampaignStats = async (campaignIds) => {
  try {
    const uniqueIds = [...new Set(campaignIds)];
    await Promise.all(
      uniqueIds.map(id => autoSyncCampaignStats(id))
    );
    console.log(`[AutoSync] Batch synced ${uniqueIds.length} campaigns`);
  } catch (error) {
    console.error('[AutoSync] Batch error:', error.message);
  }
};

// Schedule periodic sync for active campaigns
export const schedulePeriodicSync = () => {
  setInterval(async () => {
    try {
      const activeCampaigns = await Campaign.find({
        status: { $in: ['processing', 'pending'] },
        isMaster: false
      }).select('_id').limit(50);
      
      if (activeCampaigns.length > 0) {
        await batchSyncCampaignStats(activeCampaigns.map(c => c._id));
      }
    } catch (error) {
      console.error('[AutoSync] Periodic sync error:', error.message);
    }
  }, 30000); // Every 30 seconds
};
