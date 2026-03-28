import mongoose from 'mongoose';
import connectDB from '../src/db/index.js';

async function fixCampaign280302() {
  try {
    await connectDB();
    console.log('🔍 Fixing duplicates for campaign 280302...');

    const collection = mongoose.connection.db.collection('contact_campaign_messages');
    const campaignId = new mongoose.Types.ObjectId('280302');
    
    // Get current count for this campaign
    const totalCount = await collection.countDocuments({ campaignId });
    console.log(`📊 Current contacts for campaign 280302: ${totalCount}`);
    
    // Find duplicates based on campaignId + recipientPhoneNumber
    const duplicates = await collection.aggregate([
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

    console.log(`📊 Found ${duplicates.length} duplicate phone numbers in campaign 280302`);

    let totalRemoved = 0;
    
    for (const duplicate of duplicates) {
      // Sort by createdAt and keep the oldest (first) document
      const sortedDocs = duplicate.docs.sort((a, b) => 
        new Date(a.createdAt) - new Date(b.createdAt)
      );
      
      // Remove all except the first (oldest) document
      const docsToRemove = sortedDocs.slice(1).map(doc => doc._id);
      
      if (docsToRemove.length > 0) {
        const result = await collection.deleteMany({
          _id: { $in: docsToRemove }
        });
        
        totalRemoved += result.deletedCount;
        console.log(`🗑️  Removed ${result.deletedCount} duplicates for phone ${duplicate._id.recipientPhoneNumber}`);
      }
    }

    // Get final count
    const finalCount = await collection.countDocuments({ campaignId });
    
    console.log(`✅ Campaign 280302 cleanup complete!`);
    console.log(`📊 Before: ${totalCount} contacts`);
    console.log(`📊 After: ${finalCount} contacts`);
    console.log(`📊 Removed: ${totalRemoved} duplicates`);
    console.log(`📊 Unique contacts: ${finalCount}`);

    // Update campaign stats
    const Campaign = (await import('../src/models/campaign.model.js')).default;
    await Campaign.updateOne(
      { _id: campaignId },
      {
        $set: {
          'stats.total': finalCount,
          'stats.pending': finalCount
        }
      }
    );
    
    console.log(`✅ Updated campaign 280302 stats: total=${finalCount}, pending=${finalCount}`);

  } catch (error) {
    console.error('❌ Error fixing campaign 280302:', error);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

fixCampaign280302();