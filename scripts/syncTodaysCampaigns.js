import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectWithRetry, closeConnection, setupGracefulShutdown } from './mongoConnection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const connectDB = async () => {
  try {
    await connectWithRetry();
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

    console.log(`✅ ${campaign.name}: total=${newStats.total}, sent=${newStats.sent}, delivered=${newStats.delivered}, read=${newStats.read}, replied=${newStats.replied}, failed=${newStats.failed}`);
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

    // Get command line arguments for date range
    const args = process.argv.slice(2);
    let startDate, endDate;

    if (args.length >= 1) {
      // Custom date provided (YYYY-MM-DD format)
      const dateStr = args[0];
      startDate = new Date(dateStr + 'T00:00:00.000Z');
      endDate = new Date(dateStr + 'T23:59:59.999Z');
      console.log(`📅 Syncing campaigns for: ${dateStr}`);
    } else {
      // Default: Today's campaigns
      const today = new Date();
      startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
      endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
      console.log(`📅 Syncing today's campaigns: ${startDate.toDateString()}`);
    }

    // Find campaigns created or updated today
    const todaysCampaigns = await Campaign.find({
      $or: [
        { createdAt: { $gte: startDate, $lte: endDate } },
        { updatedAt: { $gte: startDate, $lte: endDate } },
        { 'stats.lastUpdated': { $gte: startDate, $lte: endDate } }
      ]
    }).select('_id name createdAt').lean();

    if (todaysCampaigns.length === 0) {
      console.log('📊 No campaigns found for the specified date range');
      await closeConnection();
      return;
    }

    console.log(`📊 Found ${todaysCampaigns.length} campaigns to sync`);
    console.log('🔄 Starting sync process...');

    let synced = 0;
    let failed = 0;

    for (let i = 0; i < todaysCampaigns.length; i++) {
      const campaign = todaysCampaigns[i];
      
      try {
        console.log(`📝 [${i + 1}/${todaysCampaigns.length}] Syncing: ${campaign.name}`);
        
        const result = await syncCampaignStats(campaign._id, Campaign, ContactCampaignMessage);
        if (result.success) {
          synced++;
        } else {
          failed++;
        }
      } catch (error) {
        console.error(`❌ Campaign ${campaign.name}:`, error.message);
        failed++;
      }

      // Small delay to avoid overwhelming database
      if (i % 10 === 0 && i > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log(`\n🎉 SYNC COMPLETE:`);
    console.log(`✅ Successfully synced: ${synced} campaigns`);
    console.log(`❌ Failed: ${failed} campaigns`);
    console.log(`📊 Total processed: ${todaysCampaigns.length} campaigns`);

    await closeConnection();
  } catch (error) {
    console.error('❌ Script error:', error);
    await closeConnection();
    process.exit(1);
  }
};

// Setup graceful shutdown
setupGracefulShutdown();

main();