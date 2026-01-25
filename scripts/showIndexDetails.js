import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function showIndexDetails() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const db = mongoose.connection.db;
    const collection = db.collection('contact_campaign_messages');

    const indexes = await collection.indexes();
    console.log('📋 Detailed Index Information:\n');
    indexes.forEach(idx => {
      console.log(`Index: ${idx.name}`);
      console.log(`  Keys: ${JSON.stringify(idx.key)}`);
      console.log(`  Unique: ${idx.unique || false}`);
      console.log(`  Sparse: ${idx.sparse || false}`);
      console.log('');
    });

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

showIndexDetails();
