import { connectWithRetry, closeConnection, setupGracefulShutdown } from './mongoConnection.js';
import mongoose from 'mongoose';

setupGracefulShutdown();

async function getMonthlyStats(monthsBack = 1) {
  try {
    await connectWithRetry();
    console.log('Connected to MongoDB\n');

    // Import models
    const Campaign = (await import('../src/models/campaign.model.js')).default;
    const ArchivedCampaign = (await import('../src/models/archivedCampaign.model.js')).default;
    const User = (await import('../src/models/user.model.js')).default;
    const now = new Date();
    const targetDate = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
    const startDate = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);
    const endDate = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0, 23, 59, 59, 999);

    console.log(`\n📊 Campaign Statistics for ${startDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`);
    console.log(`Period: ${startDate.toISOString()} to ${endDate.toISOString()}\n`);

    // Active campaigns
    const activeCampaigns = await Campaign.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: null,
          totalCampaigns: { $sum: 1 },
          totalMessages: { $sum: '$stats.total' },
          totalSent: { $sum: '$stats.sent' },
          totalDelivered: { $sum: '$stats.delivered' },
          totalRead: { $sum: '$stats.read' },
          totalReplied: { $sum: '$stats.replied' },
          totalFailed: { $sum: '$stats.failed' },
          totalExpired: { $sum: '$stats.expired' },
          totalCost: { $sum: '$actualCost' },
          totalRefunded: { $sum: '$refundedAmount' }
        }
      }
    ]);

    // Archived campaigns
    const archivedCampaigns = 
    await ArchivedCampaign.aggregate([
      {
        $match: {
          campaignCreatedAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: null,
          totalCampaigns: { $sum: 1 },
          totalMessages: { $sum: '$stats.total' },
          totalSent: { $sum: '$stats.sent' },
          totalDelivered: { $sum: '$stats.delivered' },
          totalRead: { $sum: '$stats.read' },
          totalFailed: { $sum: '$stats.failed' },
          totalExpired: { $sum: '$stats.expired' },
          totalCost: { $sum: '$actualCost' },
          totalRefunded: { $sum: '$refundedAmount' }
        }
      }
    ]);

    const active = activeCampaigns[0] || { totalCampaigns: 0, totalMessages: 0, totalSent: 0, totalDelivered: 0, totalRead: 0, totalReplied: 0, totalFailed: 0, totalExpired: 0, totalCost: 0, totalRefunded: 0 };
    const archived = archivedCampaigns[0] || { totalCampaigns: 0, totalMessages: 0, totalSent: 0, totalDelivered: 0, totalRead: 0, totalFailed: 0, totalExpired: 0, totalCost: 0, totalRefunded: 0 };

    const combined = {
      totalCampaigns: active.totalCampaigns + archived.totalCampaigns,
      totalMessages: active.totalMessages + archived.totalMessages,
      totalSent: active.totalSent + archived.totalSent,
      totalDelivered: active.totalDelivered + archived.totalDelivered,
      totalRead: active.totalRead + archived.totalRead,
      totalReplied: active.totalReplied || 0,
      totalFailed: active.totalFailed + archived.totalFailed,
      totalExpired: active.totalExpired + archived.totalExpired,
      totalCost: active.totalCost + archived.totalCost,
      totalRefunded: active.totalRefunded + archived.totalRefunded
    };

    console.log('📈 OVERALL STATISTICS');
    console.log('─────────────────────────────────────');
    console.log(`Total Campaigns: ${combined.totalCampaigns.toLocaleString()}`);
    console.log(`  - Active: ${active.totalCampaigns.toLocaleString()}`);
    console.log(`  - Archived: ${archived.totalCampaigns.toLocaleString()}`);
    console.log(`\nTotal Messages: ${combined.totalMessages.toLocaleString()}`);
    console.log(`  - Sent: ${combined.totalSent.toLocaleString()} (${((combined.totalSent / combined.totalMessages) * 100 || 0).toFixed(2)}%)`);
    console.log(`  - Delivered: ${combined.totalDelivered.toLocaleString()} (${((combined.totalDelivered / combined.totalMessages) * 100 || 0).toFixed(2)}%)`);
    console.log(`  - Read: ${combined.totalRead.toLocaleString()} (${((combined.totalRead / combined.totalMessages) * 100 || 0).toFixed(2)}%)`);
    console.log(`  - Replied: ${combined.totalReplied.toLocaleString()} (${((combined.totalReplied / combined.totalMessages) * 100 || 0).toFixed(2)}%)`);
    console.log(`  - Failed: ${combined.totalFailed.toLocaleString()} (${((combined.totalFailed / combined.totalMessages) * 100 || 0).toFixed(2)}%)`);
    console.log(`  - Expired: ${combined.totalExpired.toLocaleString()} (${((combined.totalExpired / combined.totalMessages) * 100 || 0).toFixed(2)}%)`);
    console.log(`\n💰 FINANCIAL SUMMARY`);
    console.log(`─────────────────────────────────────`);
    console.log(`Total Cost: ₹${combined.totalCost.toLocaleString()}`);
    console.log(`Total Refunded: ₹${combined.totalRefunded.toLocaleString()}`);
    console.log(`Net Revenue: ₹${(combined.totalCost - combined.totalRefunded).toLocaleString()}`);

    // Top users by campaigns
    const topUsersByCampaigns = await Campaign.aggregate([
      { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
      { $group: { _id: '$userId', count: { $sum: 1 }, totalMessages: { $sum: '$stats.total' }, totalCost: { $sum: '$actualCost' } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $unwind: '$user' },
      { $project: { name: '$user.name', email: '$user.email', campaigns: '$count', messages: '$totalMessages', cost: '$totalCost' } }
    ]);

    console.log(`\n👥 TOP 5 USERS BY CAMPAIGNS`);
    console.log(`─────────────────────────────────────`);
    topUsersByCampaigns.forEach((user, i) => {
      console.log(`${i + 1}. ${user.name} (${user.email})`);
      console.log(`   Campaigns: ${user.campaigns}, Messages: ${user.messages.toLocaleString()}, Cost: ₹${user.cost.toLocaleString()}`);
    });

    // Campaign status breakdown
    const statusBreakdown = await Campaign.aggregate([
      { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    console.log(`\n📊 CAMPAIGN STATUS BREAKDOWN`);
    console.log(`─────────────────────────────────────`);
    statusBreakdown.forEach(status => {
      console.log(`${status._id}: ${status.count}`);
    });

    console.log('\n✅ Monthly stats generated successfully\n');

  } catch (error) {
    console.error('❌ Error generating monthly stats:', error);
  } finally {
    await closeConnection();
    process.exit(0);
  }
}

// Get month from command line argument (default: 1 = last month)
const monthsBack = parseInt(process.argv[2]) || 1;
getMonthlyStats(monthsBack);
