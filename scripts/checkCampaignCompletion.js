import mongoose from 'mongoose';
import connectDB from '../src/db/index.js';

async function checkCampaignCompletion() {
  try {
    await connectDB();
    
    const Campaign = (await import('../src/models/campaign.model.js')).default;
    const collection = mongoose.connection.db.collection('contact_campaign_messages');
    
    // Find campaigns in 'processing' status
    const processingCampaigns = await Campaign.find({ 
      status: 'processing' 
    }).select('_id stats.total').lean();
    
    console.log(`[CampaignChecker] Found ${processingCampaigns.length} processing campaigns`);
    
    for (const campaign of processingCampaigns) {
      const campaignId = campaign._id;
      const expectedTotal = campaign.stats?.total || 0;
      
      // Count actual contacts in database
      const actualCount = await collection.countDocuments({ campaignId });
      
      console.log(`[CampaignChecker] Campaign ${campaignId}: Expected=${expectedTotal}, Actual=${actualCount}`);
      
      // If we have at least 90% of expected contacts, mark as pending
      const threshold = Math.floor(expectedTotal * 0.9);
      
      if (actualCount >= threshold && expectedTotal > 0) {
        await Campaign.updateOne(
          { _id: campaignId },
          { 
            status: 'pending',
            'stats.total': actualCount,
            'stats.pending': actualCount
          }
        );
        
        console.log(`[CampaignChecker] ✅ Campaign ${campaignId} → pending (${actualCount} contacts)`);
      } else if (expectedTotal === 0) {
        // If no expected total, use a reasonable threshold
        if (actualCount >= 1000) {
          await Campaign.updateOne(
            { _id: campaignId },
            { 
              status: 'pending',
              'stats.total': actualCount,
              'stats.pending': actualCount
            }
          );
          
          console.log(`[CampaignChecker] ✅ Campaign ${campaignId} → pending (${actualCount} contacts, no expected total)`);
        }
      }
    }
    
  } catch (error) {
    console.error('[CampaignChecker] Error:', error);
  } finally {
    await mongoose.connection.close();
  }
}

// Run immediately
checkCampaignCompletion();