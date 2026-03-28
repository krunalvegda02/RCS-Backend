import mongoose from 'mongoose';

async function fixCampaign280302() {
  try {
    // Direct MongoDB connection
    const MONGODB_URI = 'mongodb+srv://sikarwarvishal75_db_user:Gama%40123@cluster0.whqwih.mongodb.net/rcs?retryWrites=true&w=majority';
    
    await mongoose.connect(MONGODB_URI);
    console.log('✅ MongoDB connected');
    console.log('🔍 Fixing duplicates for campaign 280302...');

    const collection = mongoose.connection.db.collection('contact_campaign_messages');
    const campaignId = new mongoose.Types.ObjectId('67456b6e4b8b8b6f21303e6'); // Assuming this is the actual ObjectId
    
    // Try with string first to see if campaign exists
    let totalCount = await collection.countDocuments({ campaignId: '280302' });
    if (totalCount === 0) {
      // Try with ObjectId
      totalCount = await collection.countDocuments({ campaignId });
    }
    
    console.log(`📊 Current contacts for campaign 280302: ${totalCount}`);
    
    if (totalCount === 0) {
      console.log('❌ Campaign 280302 not found. Checking all campaigns...');
      
      // List all campaigns to find the correct one
      const campaigns = await collection.distinct('campaignId');
      console.log('📋 Available campaign IDs:', campaigns.slice(0, 10)); // Show first 10
      
      return;
    }
    
    // Find duplicates based on campaignId + recipientPhoneNumber
    const duplicates = await collection.aggregate([
      {
        $match: { 
          $or: [
            { campaignId: '280302' },
            { campaignId }
          ]
        }
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
    const finalCount = await collection.countDocuments({ 
      $or: [
        { campaignId: '280302' },
        { campaignId }
      ]
    });
    
    console.log(`✅ Campaign 280302 cleanup complete!`);
    console.log(`📊 Before: ${totalCount} contacts`);
    console.log(`📊 After: ${finalCount} contacts`);
    console.log(`📊 Removed: ${totalRemoved} duplicates`);
    console.log(`📊 Unique contacts: ${finalCount}`);

  } catch (error) {
    console.error('❌ Error fixing campaign 280302:', error);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

fixCampaign280302();