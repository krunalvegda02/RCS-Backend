// import mongoose from 'mongoose';
// import dotenv from 'dotenv';
// import path from 'path';
// import { fileURLToPath } from 'url';
// import { connectWithRetry, closeConnection, setupGracefulShutdown } from './mongoConnection.js';

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

// dotenv.config({ path: path.join(__dirname, '../.env') });

// const connectDB = async () => {
//   try {
//     await connectWithRetry();
//   } catch (error) {
//     console.error('❌ MongoDB connection error:', error);
//     process.exit(1);
//   }
// };

// const syncCampaignStats = async (campaignId, Campaign, ContactCampaignMessage) => {
//   try {
//     const campaign = await Campaign.findById(campaignId).select('_id name stats');
//     if (!campaign) {
//       console.log(`⚠️  Campaign ${campaignId} not found`);
//       return { success: false };
//     }

//     // Use EXACT same logic as refreshStats in campaign.controller.js
//     const stats = await ContactCampaignMessage.aggregate([
//       { $match: { campaignId: campaign._id } },
//       {
//         $group: {
//           _id: null,
//           total: { $sum: 1 },
//           pending: { $sum: { $cond: [{ $in: ['$status', ['pending', 'draft', 'queued']] }, 1, 0] } },
//           sent: { $sum: { $cond: [{ $in: ['$status', ['sent', 'delivered', 'read', 'replied']] }, 1, 0] } },
//           delivered: { $sum: { $cond: [{ $in: ['$status', ['delivered', 'read', 'replied']] }, 1, 0] } },
//           read: { $sum: { $cond: [{ $in: ['$status', ['read', 'replied']] }, 1, 0] } },
//           replied: { $sum: { $cond: [{ $eq: ['$status', 'replied'] }, 1, 0] } },
//           failed: { $sum: { $cond: [{ $in: ['$status', ['failed', 'bounced']] }, 1, 0] } },
//           expired: { $sum: { $cond: [{ $eq: ['$status', 'expired'] }, 1, 0] } }
//         }
//       }
//     ]);

//     const newStats = stats[0] || { 
//       total: 0, pending: 0, sent: 0, delivered: 0, 
//       read: 0, replied: 0, failed: 0, expired: 0 
//     };

//     // Update campaign stats - EXACT same as controller
//     await Campaign.updateOne(
//       { _id: campaign._id },
//       {
//         $set: {
//           'stats.total': newStats.total,
//           'stats.pending': newStats.pending,
//           'stats.sent': newStats.sent,
//           'stats.delivered': newStats.delivered,
//           'stats.read': newStats.read,
//           'stats.replied': newStats.replied,
//           'stats.failed': newStats.failed,
//           'stats.expired': newStats.expired,
//           'stats.lastUpdated': new Date()
//         }
//       }
//     );

//     console.log(`✅ ${campaign.name}: sent=${newStats.sent}, failed=${newStats.failed}`);
//     return { success: true };
//   } catch (error) {
//     console.error(`❌ syncCampaignStats error for ${campaignId}:`, error.message);
//     return { success: false };
//   }
// };

// const main = async () => {
//   try {
//     await connectWithRetry();

//     const Campaign = mongoose.model('Campaign', new mongoose.Schema({}, { strict: false }));
//     const ContactCampaignMessage = mongoose.model('ContactCampaignMessage', new mongoose.Schema({}, { strict: false, collection: 'contact_campaign_messages' }));
//     const MessageLog = mongoose.model('MessageLog', new mongoose.Schema({}, { strict: false, collection: 'message_logs' }));

//     // Find campaigns from today (instead of last 10 minutes)
//     const today = new Date();
//     const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
//     const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
    
//     console.log(`📅 Syncing campaigns from: ${startOfDay.toDateString()}`);
    
//     // Find campaigns created or updated today
//     const todaysCampaigns = await Campaign.find({
//       $or: [
//         { createdAt: { $gte: startOfDay, $lte: endOfDay } },
//         { updatedAt: { $gte: startOfDay, $lte: endOfDay } }
//       ],
//       // EXCLUDE campaigns with status 'settled' - they have manual stats
//       status: { $ne: 'settled' }
//     }).select('_id').lean();

//     if (todaysCampaigns.length === 0) {
//       console.log('📊 No campaigns found for today');
//       await closeConnection();
//       return;
//     }

//     const affectedCampaigns = todaysCampaigns.map(c => c._id);

//     if (affectedCampaigns.length === 0) {
//       console.log('📊 No campaigns with recent updates');
//       await closeConnection();
//       return;
//     }

//     console.log(`📊 Found ${affectedCampaigns.length} campaigns created/updated today`);

//     let synced = 0;
//     for (const campaignId of affectedCampaigns) {
//       if (!campaignId) continue;
      
//       try {
//         const result = await syncCampaignStats(campaignId, Campaign, ContactCampaignMessage);
//         if (result.success) synced++;
//       } catch (error) {
//         console.error(`❌ Campaign ${campaignId}:`, error.message);
//       }
//     }

//     console.log(`📈 ✅ ${synced} today's campaigns synced`);
//     await closeConnection();
//   } catch (error) {
//     console.error('❌ Script error:', error);
//     await closeConnection();
//     process.exit(1);
//   }
// };

// // Setup graceful shutdown
// setupGracefulShutdown();

// main();


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

    console.log(`✅ ${campaign.name}: sent=${newStats.sent}, failed=${newStats.failed}`);
    return { success: true };
  } catch (error) {
    console.error(`❌ syncCampaignStats error for ${campaignId}:`, error.message);
    return { success: false };
  }
};

const main = async () => {
  try {
    await connectWithRetry();

    const Campaign = mongoose.model('Campaign', new mongoose.Schema({}, { strict: false }));
    const ContactCampaignMessage = mongoose.model('ContactCampaignMessage', new mongoose.Schema({}, { strict: false, collection: 'contact_campaign_messages' }));
    const MessageLog = mongoose.model('MessageLog', new mongoose.Schema({}, { strict: false, collection: 'message_logs' }));

    // CAMPAIGNS TO EXCLUDE FROM SYNC (manual stats)
    const EXCLUDED_CAMPAIGNS = [
      '69cbd4a46a73a08e733df0b9', // MAHADEV 4 - messages deleted, manual stats
      // Add more campaign IDs here if needed
    ];

    // Find campaigns from today (instead of last 10 minutes)
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
    
    console.log(`📅 Syncing campaigns from: ${startOfDay.toDateString()}`);
    
    // Find campaigns created or updated today
    const todaysCampaigns = await Campaign.find({
      $or: [
        { createdAt: { $gte: startOfDay, $lte: endOfDay } },
        { updatedAt: { $gte: startOfDay, $lte: endOfDay } }
      ],
      // EXCLUDE campaigns with status 'settled' - they have manual stats
      status: { $ne: 'settled' },
      // EXCLUDE specific campaigns from the exclusion list
      _id: { $nin: EXCLUDED_CAMPAIGNS.map(id => new mongoose.Types.ObjectId(id)) }
    }).select('_id').lean();

    if (todaysCampaigns.length === 0) {
      console.log('📊 No campaigns found for today');
      await closeConnection();
      return;
    }

    const affectedCampaigns = todaysCampaigns.map(c => c._id);

    if (affectedCampaigns.length === 0) {
      console.log('📊 No campaigns with recent updates');
      await closeConnection();
      return;
    }

    console.log(`📊 Found ${affectedCampaigns.length} campaigns created/updated today`);

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

    console.log(`📈 ✅ ${synced} today's campaigns synced`);
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





// # SSH into production
// ssh root@167.86.106.173

// # Run manually
// cd /var/www/rcs-backend
// node scripts/syncAffectedCampaigns.js

// # Watch logs live
// tail -f /var/log/campaign-stats-affected.log




// // # SSH into production
// // ssh root@167.86.106.173

// // # Run manually
// // cd /var/www/rcs-backend
// // node scripts/syncAffectedCampaigns.js

// // # Watch logs live
// // tail -f /var/log/campaign-stats-affected.log










