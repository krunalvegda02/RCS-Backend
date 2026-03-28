import mongoose from 'mongoose';

async function fixSpecificCampaign() {
  try {
    // Direct MongoDB connection
    const MONGODB_URI = 'mongodb+srv://sikarwarvishal75_db_user:Gama%40123@cluster0.whqwih.mongodb.net/rcs?retryWrites=true&w=majority';
    
    await mongoose.connect(MONGODB_URI);
    console.log('✅ MongoDB connected');

    const contactCollection = mongoose.connection.db.collection('contact_campaign_messages');
    const campaignCollection = mongoose.connection.db.collection('campaigns');
    
    const campaignId = new mongoose.Types.ObjectId('69c7961b7fafa4040a676413');
    
    console.log(`🔍 Fixing duplicates for campaign ${campaignId}...`);
    
    // Get current count for this campaign
    const totalCount = await contactCollection.countDocuments({ campaignId });
    console.log(`📊 Current contacts for campaign: ${totalCount}`);
    
    if (totalCount === 0) {
      console.log('❌ Campaign not found or has no contacts');
      return;
    }
    
    // Find duplicates based on campaignId + recipientPhoneNumber
    console.log('🔍 Finding duplicates...');
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

    if (duplicates.length === 0) {
      console.log('✅ No duplicates found!');
      return;
    }

    let totalRemoved = 0;
    let processedCount = 0;
    
    console.log('🗑️  Removing duplicates...');
    
    for (const duplicate of duplicates) {
      processedCount++;
      
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
        
        // Show progress every 100 processed
        if (processedCount % 100 === 0) {
          console.log(`📈 Progress: ${processedCount}/${duplicates.length} processed, ${totalRemoved} removed so far`);
        }
      }
    }

    // Get final count
    const finalCount = await contactCollection.countDocuments({ campaignId });
    
    console.log(`\n✅ Campaign cleanup complete!`);
    console.log(`📊 Campaign ID: ${campaignId}`);
    console.log(`📊 Before: ${totalCount} contacts`);
    console.log(`📊 After: ${finalCount} contacts`);
    console.log(`📊 Removed: ${totalRemoved} duplicates`);
    console.log(`📊 Unique contacts: ${finalCount}`);
    console.log(`📊 Reduction: ${((totalCount - finalCount) / totalCount * 100).toFixed(1)}%`);
    
    // Update campaign stats
    console.log('🔄 Updating campaign stats...');
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
      console.log(`✅ Updated campaign stats: total=${finalCount}, pending=${finalCount}`);
    } else {
      console.log(`⚠️  Campaign document not found in campaigns collection`);
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

fixSpecificCampaign();