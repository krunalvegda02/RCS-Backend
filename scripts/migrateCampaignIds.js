import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function migrateCampaignIds() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const db = mongoose.connection.db;
    const collection = db.collection('contact_campaign_messages');

    const documents = await collection.find({ campaigns: { $exists: true, $ne: [] } }).toArray();
    console.log(`Found ${documents.length} documents to update`);

    let updated = 0;
    for (const doc of documents) {
      const campaignIds = [...new Set(doc.campaigns.map(c => c.campaignId))];
      await collection.updateOne(
        { _id: doc._id },
        { $set: { campaignIds } }
      );
      updated++;
      if (updated % 100 === 0) console.log(`Updated ${updated} documents...`);
    }

    console.log(`✅ Migration complete: ${updated} documents updated`);
    await mongoose.disconnect();
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrateCampaignIds();
