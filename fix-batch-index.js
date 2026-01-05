import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const fixBatchIndex = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    const collection = db.collection('contactbatches');

    // Drop the problematic batchId index
    try {
      await collection.dropIndex('batchId_1');
      console.log('✅ Dropped batchId_1 index');
    } catch (error) {
      if (error.code === 27) {
        console.log('ℹ️  batchId_1 index does not exist');
      } else {
        throw error;
      }
    }

    // List all indexes
    const indexes = await collection.indexes();
    console.log('\n📋 Current indexes:');
    indexes.forEach(idx => {
      console.log(`  - ${JSON.stringify(idx.key)} (${idx.name})`);
    });

    console.log('\n✅ Database fix completed!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
};

fixBatchIndex();
