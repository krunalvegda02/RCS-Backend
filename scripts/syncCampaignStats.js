import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB connected');
    console.log('📊 Database:', mongoose.connection.db.databaseName);
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

const syncCampaignStats = async (campaignId, Campaign, ContactCampaignMessage) => {
  const campaign = await Campaign.findById(campaignId).select('_id name stats');
  if (!campaign) {
    return { success: false };
  }

  const totalCount = await ContactCampaignMessage.countDocuments({ campaignId: campaign._id });

  if (totalCount === 0) {
    console.log(`⚠️  ${campaign.name}: No messages`);
    return { success: false };
  }

  const stats = await ContactCampaignMessage.aggregate([
    { $match: { campaignId: campaign._id } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        pending: { $sum: { $cond: [{ $in: ['$status', ['pending', 'draft', 'queued']] }, 1, 0] } },
        sent: { $sum: { $cond: [{ $in: ['$status', ['sent', 'delivered', 'read', 'replied']] }, 1, 0] } },
        delivered: { $sum: { $cond: [{ $in: ['$status', ['delivered', 'read', 'replied']] }, 1, 0] } },
        read: { $sum: { $cond: [{ $in: ['$status', ['read', 'replied']] }, 1, 0] } },
        replied: { $sum: { $cond: [{ $eq: ['$status', 'replied'] }, 1, 0] } },
        expired: { $sum: { $cond: [{ $eq: ['$status', 'expired'] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $in: ['$status', ['failed', 'bounced']] }, 1, 0] } }
      }
    }
  ]);

  const newStats = stats[0] || { total: 0, pending: 0, sent: 0, delivered: 0, read: 0, replied: 0, expired: 0, failed: 0 };

  await Campaign.updateOne(
    { _id: campaign._id },
    {
      $set: {
        'stats.total': newStats.total,
        'stats.pending': newStats.pending,
        'stats.sent': newStats.sent,
        'stats.delivered': newStats.delivered,
        'stats.read': newStats.read,
        'stats.replied': newStats.replied,
        'stats.expired': newStats.expired,
        'stats.failed': newStats.failed,
        'stats.bounced': 0,
        'stats.lastUpdated': new Date()
      }
    }
  );

  console.log(`✅ ${campaign.name}: total=${newStats.total}, sent=${newStats.sent}, failed=${newStats.failed}`);
  return { success: true };
};

const main = async () => {
  const campaignId = process.argv[2];
  const mode = process.argv[3] || 'recent'; // 'recent', 'all', or 'affected'

  await connectDB();

  const Campaign = mongoose.model('Campaign', new mongoose.Schema({}, { strict: false }));
  const ContactCampaignMessage = mongoose.model('ContactCampaignMessage', new mongoose.Schema({}, { strict: false, collection: 'contact_campaign_messages' }));

  if (campaignId && campaignId !== 'all') {
    await syncCampaignStats(campaignId, Campaign, ContactCampaignMessage);
  } else {
    let campaigns;
    
    if (mode === 'recent') {
      // Only sync campaigns from last 4 days
      const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
      campaigns = await Campaign.find({
        createdAt: { $gte: fourDaysAgo }
      }).select('_id name createdAt');
      console.log(`📊 Found ${campaigns.length} recent campaigns (last 4 days)`);
    } else {
      campaigns = await Campaign.find({}).select('_id name');
      console.log(`📊 Found ${campaigns.length} campaigns (all)`);
    }

    let synced = 0, skipped = 0;

    for (const campaign of campaigns) {
      try {
        const result = await syncCampaignStats(campaign._id, Campaign, ContactCampaignMessage);
        if (result.success) synced++;
        else skipped++;
      } catch (error) {
        console.error(`❌ ${campaign.name}:`, error.message);
        skipped++;
      }
    }

    console.log(`📈 ✅ ${synced} synced, ⚠️ ${skipped} skipped (mode: ${mode})`);
  }

  await mongoose.connection.close();
  console.log('\n✅ Done');
  process.exit(0);
};

main();
