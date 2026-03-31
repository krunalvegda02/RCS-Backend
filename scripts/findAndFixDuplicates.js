import { connectWithRetry, closeConnection, setupGracefulShutdown } from './mongoConnection.js';
import mongoose from 'mongoose';

// Setup graceful shutdown
setupGracefulShutdown();

async function findAndFixCampaign() {
  try {
    await connectWithRetry();
    console.log('✅ MongoDB connected');

    const contactCollection = mongoose.connection.db.collection('contact_campaign_messages');
    const campaignCollection = mongoose.connection.db.collection('campaigns');
    
    // First, let's find campaigns with high contact counts
    console.log('🔍 Finding campaigns with high contact counts...');
    
    const campaignCounts = await contactCollection.aggregate([
      {
        $group: {
          _id: '$campaignId',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      },
      {
        $limit: 10
      }
    ]).toArray();
    
    console.log('📊 Top campaigns by contact count:');
    for (const campaign of campaignCounts) {
      console.log(`Campaign ${campaign._id}: ${campaign.count} contacts`);
    }
    
    // Look for campaign with name or ID containing 280302
    console.log('\n🔍 Looking for campaign 280302...');
    const campaign280302 = await campaignCollection.findOne({
      $or: [
        { name: /280302/i },
        { _id: '280302' }
      ]
    });
    
    if (campaign280302) {
      console.log('✅ Found campaign 280302:', campaign280302);
    } else {
      console.log('❌ Campaign 280302 not found in campaigns collection');
    }
    
    // Let's fix the campaign with the highest contact count (likely the problematic one)
    const targetCampaign = campaignCounts[0];
    const campaignId = targetCampaign._id;
    const contactCount = targetCampaign.count;
    
    console.log(`\n🎯 Fixing campaign ${campaignId} with ${contactCount} contacts...`);
    
    // Find duplicates based on campaignId + recipientPhoneNumber
    const duplicates = await contactCollection.aggregate([
      {
        $match: { campaignId }
      },
      {
        $group: {
          _id: {
            campaignId: '$campaignId',
            recipientPhoneNumber: '$recipientPhoneNumber'
          },
          count: { $sum: 1 },
          docs: { $push: { _id: '$_id', createdAt: '$createdAt' } }
        }
      },
      {
        $match: {
          count: { $gt: 1 }
        }
      }
    ]).toArray();

    console.log(`📊 Found ${duplicates.length} duplicate phone numbers`);

    let totalRemoved = 0;
    
    for (const duplicate of duplicates) {
      // Sort by createdAt and keep the oldest (first) document
      const sortedDocs = duplicate.docs.sort((a, b) => 
        new Date(a.createdAt) - new Date(b.createdAt)
      );
      
      // Remove all except the first (oldest) document
      const docsToRemove = sortedDocs.slice(1).map(doc => doc._id);
      
      if (docsToRemove.length > 0) {
        const result = await contactCollection.deleteMany({
          _id: { $in: docsToRemove }
        });
        
        totalRemoved += result.deletedCount;
        
        if (duplicate.count > 10) { // Only log for high duplicate counts
          console.log(`🗑️  Removed ${result.deletedCount} duplicates for phone ${duplicate._id.recipientPhoneNumber}`);
        }
      }
    }

    // Get final count
    const finalCount = await contactCollection.countDocuments({ campaignId });
    
    console.log(`\n✅ Campaign ${campaignId} cleanup complete!`);
    console.log(`📊 Before: ${contactCount} contacts`);
    console.log(`📊 After: ${finalCount} contacts`);
    console.log(`📊 Removed: ${totalRemoved} duplicates`);
    console.log(`📊 Unique contacts: ${finalCount}`);
    
    // Update campaign stats if it exists
    const campaignUpdate = await campaignCollection.updateOne(
      { _id: campaignId },
      {
        $set: {
          'stats.total': finalCount,
          'stats.pending': finalCount
        }
      }
    );
    
    if (campaignUpdate.modifiedCount > 0) {
      console.log(`✅ Updated campaign stats`);
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await closeConnection();
    process.exit(0);
  }
}

findAndFixCampaign();