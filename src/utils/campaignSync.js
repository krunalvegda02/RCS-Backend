import mongoose from 'mongoose';

// Optimized campaign stats sync using aggregation pipeline
export const syncCampaignStatsOptimized = async (campaignIds, Campaign, ContactCampaignMessage) => {
  if (!campaignIds || campaignIds.length === 0) return;

  try {
    // Use aggregation pipeline to calculate stats for multiple campaigns at once
    const statsResults = await ContactCampaignMessage.aggregate([
      { 
        $match: { 
          campaignId: { $in: campaignIds.map(id => new mongoose.Types.ObjectId(id)) }
        }
      },
      {
        $group: {
          _id: '$campaignId',
          total: { $sum: 1 },
          pending: { $sum: { $cond: [{ $in: ['$status', ['pending', 'draft', 'queued']] }, 1, 0] } },
          sent: { $sum: { $cond: [{ $in: ['$status', ['sent', 'delivered', 'read', 'replied', 'failed']] }, 1, 0] } },
          delivered: { $sum: { $cond: [{ $in: ['$status', ['delivered', 'read', 'replied']] }, 1, 0] } },
          read: { $sum: { $cond: [{ $in: ['$status', ['read', 'replied']] }, 1, 0] } },
          replied: { $sum: { $cond: [{ $eq: ['$status', 'replied'] }, 1, 0] } },
          expired: { $sum: { $cond: [{ $eq: ['$status', 'expired'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $in: ['$status', ['failed', 'bounced']] }, 1, 0] } }
        }
      }
    ]);

    // Bulk update campaigns
    const bulkOps = statsResults.map(stats => ({
      updateOne: {
        filter: { _id: stats._id },
        update: {
          $set: {
            'stats.total': stats.total,
            'stats.pending': stats.pending,
            'stats.sent': stats.sent,
            'stats.delivered': stats.delivered,
            'stats.read': stats.read,
            'stats.replied': stats.replied,
            'stats.expired': stats.expired,
            'stats.failed': stats.failed,
            'stats.bounced': 0,
            'stats.lastSyncAt': new Date()
          }
        }
      }
    }));

    if (bulkOps.length > 0) {
      await Campaign.bulkWrite(bulkOps, { ordered: false });
      console.log(`[CampaignSync] Updated stats for ${bulkOps.length} campaigns`);
    }

    return { success: true, updated: bulkOps.length };
  } catch (error) {
    console.error('[CampaignSync] Bulk sync error:', error.message);
    return { success: false, error: error.message };
  }
};