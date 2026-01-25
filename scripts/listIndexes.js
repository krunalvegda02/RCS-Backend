import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function listIndexes() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    const collection = db.collection('contact_campaign_messages');

    const indexes = await collection.indexes();
    console.log('\n📋 Indexes on contact_campaign_messages:');
    indexes.forEach(idx => {
      console.log(`  - ${idx.name}:`, JSON.stringify(idx.key));
    });

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

listIndexes();
