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
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

const syncCampaignStats = async (campaignId, Campaign, ContactCampaignMessage) => {
  try {
    const campaign = await Campaign.findById(campaignId).select('_id name stats');
    if (!campaign) {
      console.log(`⚠️  Campaign ${campaignId} not found`);
      return { success: false };
    }

    // Use EXACT same logic as refreshStats in campaign.controller.js
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
          failed: { $sum: { $cond: [{ $in: ['$status', ['failed', 'bounced']] }, 1, 0] } },
          expired: { $sum: { $cond: [{ $eq: ['$status', 'expired'] }, 1, 0] } }
        }
      }
    ]);

    const newStats = stats[0] || { 
      total: 0, pending: 0, sent: 0, delivered: 0, 
      read: 0, replied: 0, failed: 0, expired: 0 
    };

    // Update campaign stats - EXACT same as controller
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
          'stats.failed': newStats.failed,
          'stats.expired': newStats.expired,
          'stats.lastUpdated': new Date()
        }
      }
    );

    console.log(`✅ ${campaign.name}: sent=${newStats.sent}, failed=${newStats.failed}`);
    return { success: true };
  } catch (error) {
    console.error(`❌ syncCampaignStats error for ${campaignId}:`, error.message);
    return { success: false };
  }
};

const main = async () => {
  try {
    await connectDB();

    const Campaign = mongoose.model('Campaign', new mongoose.Schema({}, { strict: false }));
    const ContactCampaignMessage = mongoose.model('ContactCampaignMessage', new mongoose.Schema({}, { strict: false, collection: 'contact_campaign_messages' }));
    const MessageLog = mongoose.model('MessageLog', new mongoose.Schema({}, { strict: false, collection: 'message_logs' }));

    // Find campaigns from recent processed message logs
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    
    const recentLogs = await MessageLog.find({
      processed: true,
      processedAt: { $gte: tenMinutesAgo },
      messageId: { $exists: true, $ne: null }
    }).select('messageId').lean();

    if (recentLogs.length === 0) {
      console.log('📊 No recent message updates');
      await mongoose.connection.close();
      return;
    }

    const messageIds = recentLogs.map(log => log.messageId).filter(Boolean);
    
    if (messageIds.length === 0) {
      console.log('📊 No valid messageIds found');
      await mongoose.connection.close();
      return;
    }
    
    // Find affected campaigns from these messages
    const affectedCampaigns = await ContactCampaignMessage.distinct('campaignId', {
      messageId: { $in: messageIds },
      campaignId: { $exists: true, $ne: null }
    });

    if (affectedCampaigns.length === 0) {
      console.log('📊 No campaigns with recent updates');
      await mongoose.connection.close();
      return;
    }

    console.log(`📊 Found ${affectedCampaigns.length} campaigns with recent updates (from ${recentLogs.length} processed logs)`);

    let synced = 0;
    for (const campaignId of affectedCampaigns) {
      if (!campaignId) continue;
      
      try {
        const result = await syncCampaignStats(campaignId, Campaign, ContactCampaignMessage);
        if (result.success) synced++;
      } catch (error) {
        console.error(`❌ Campaign ${campaignId}:`, error.message);
      }
    }

    console.log(`📈 ✅ ${synced} affected campaigns synced`);
    await mongoose.connection.close();
  } catch (error) {
    console.error('❌ Script error:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
};

main();