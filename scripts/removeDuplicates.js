import mongoose from 'mongoose';
import connectDB from '../src/db/index.js';

async function removeDuplicateContacts() {
  try {
    await connectDB();
    console.log('🔍 Starting duplicate removal process...');

    const collection = mongoose.connection.db.collection('contact_campaign_messages');
    
    // Find duplicates based on campaignId + recipientPhoneNumber
    const duplicates = await collection.aggregate([
      {
        $group: {
          _id: {
            campaignId: '$campaignId',
            recipientPhoneNumber: '$recipientPhoneNumber'
          },
          count: { $sum: 1 },
          docs: { $push: '$_id' }
        }
      },
      {
        $match: {
          count: { $gt: 1 }
        }
      }
    ]).toArray();

    console.log(`📊 Found ${duplicates.length} duplicate groups`);

    let totalRemoved = 0;
    
    for (const duplicate of duplicates) {
      // Keep the first document, remove the rest
      const docsToRemove = duplicate.docs.slice(1);
      
      if (docsToRemove.length > 0) {
        const result = await collection.deleteMany({
          _id: { $in: docsToRemove }
        });
        
        totalRemoved += result.deletedCount;
        console.log(`🗑️  Removed ${result.deletedCount} duplicates for campaign ${duplicate._id.campaignId} - phone ${duplicate._id.recipientPhoneNumber}`);
      }
    }

    console.log(`✅ Duplicate removal complete!`);
    console.log(`📊 Total duplicates removed: ${totalRemoved}`);
    
    // Get final count
    const finalCount = await collection.countDocuments();
    console.log(`📊 Final contact count: ${finalCount}`);

  } catch (error) {
    console.error('❌ Error removing duplicates:', error);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

removeDuplicateContacts();