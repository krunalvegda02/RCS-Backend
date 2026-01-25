import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function dropIndex() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    const collection = db.collection('contact_campaign_messages');

    // Drop the problematic compound index
    try {
      await collection.dropIndex('recipientPhoneNumber_1_userId_1');
      console.log('✅ Dropped index: recipientPhoneNumber_1_userId_1');
    } catch (err) {
      if (err.code === 27) {
        console.log('ℹ️  Index does not exist, nothing to drop');
      } else {
        throw err;
      }
    }

    await mongoose.connection.close();
    console.log('✅ Done');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

dropIndex();
