import { connectWithRetry, closeConnection, setupGracefulShutdown } from './mongoConnection.js';
import mongoose from 'mongoose';

setupGracefulShutdown();

async function getSeparateMonthlyStats(monthsBack = 1) {
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

    console.log(`\n📊 SEPARATE CAMPAIGN STATISTICS for ${startDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`);
    console.log(`Period: ${startDate.toISOString()} to ${endDate.toISOString()}\n`);
    console.log('═'.repeat(80));

    // ==================== ACTIVE CAMPAIGNS ====================
    console.log('\n🟢 ACTIVE CAMPAIGNS (Not Archived)');
    console.log('─'.repeat(80));

    const activeCampaigns = await Campaign.aggregate([
      { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
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
          totalRefunded: { $sum: '$refundedAmount' },
          totalBlocked: { $sum: '$blockedAmount' }
        }
      }
    ]);

    const activeStatusBreakdown = await Campaign.aggregate([
      { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    const activeTopUsers = await Campaign.aggregate([
      { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
      { $group: { _id: '$userId', count: { $sum: 1 }, totalMessages: { $sum: '$stats.total' }, totalCost: { $sum: '$actualCost' } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $unwind: '$user' },
      { $project: { name: '$user.name', email: '$user.email', campaigns: '$count', messages: '$totalMessages', cost: '$totalCost' } }
    ]);

    const active = activeCampaigns[0] || { totalCampaigns: 0, totalMessages: 0, totalSent: 0, totalDelivered: 0, totalRead: 0, totalReplied: 0, totalFailed: 0, totalExpired: 0, totalCost: 0, totalRefunded: 0, totalBlocked: 0 };

    console.log('\n📈 OVERALL STATISTICS');
    console.log('─────────────────────────────────────');
    console.log(`Total Campaigns: ${active.totalCampaigns.toLocaleString()}`);
    console.log(`\nTotal Messages: ${active.totalMessages.toLocaleString()}`);
    console.log(`  - Sent: ${active.totalSent.toLocaleString()} (${((active.totalSent / active.totalMessages) * 100 || 0).toFixed(2)}%)`);
    console.log(`  - Delivered: ${active.totalDelivered.toLocaleString()} (${((active.totalDelivered / active.totalMessages) * 100 || 0).toFixed(2)}%)`);
    console.log(`  - Read: ${active.totalRead.toLocaleString()} (${((active.totalRead / active.totalMessages) * 100 || 0).toFixed(2)}%)`);
    console.log(`  - Replied: ${active.totalReplied.toLocaleString()} (${((active.totalReplied / active.totalMessages) * 100 || 0).toFixed(2)}%)`);
    console.log(`  - Failed: ${active.totalFailed.toLocaleString()} (${((active.totalFailed / active.totalMessages) * 100 || 0).toFixed(2)}%)`);
    console.log(`  - Expired: ${active.totalExpired.toLocaleString()} (${((active.totalExpired / active.totalMessages) * 100 || 0).toFixed(2)}%)`);
    
    console.log(`\n💰 FINANCIAL SUMMARY`);
    console.log(`─────────────────────────────────────`);
    console.log(`Total Cost: ₹${active.totalCost.toLocaleString()}`);
    console.log(`Total Refunded: ₹${active.totalRefunded.toLocaleString()}`);
    console.log(`Total Blocked: ₹${active.totalBlocked.toLocaleString()}`);
    console.log(`Net Revenue: ₹${(active.totalCost - active.totalRefunded).toLocaleString()}`);

    console.log(`\n👥 TOP 5 USERS BY CAMPAIGNS`);
    console.log(`─────────────────────────────────────`);
    activeTopUsers.forEach((user, i) => {
      console.log(`${i + 1}. ${user.name} (${user.email})`);
      console.log(`   Campaigns: ${user.campaigns}, Messages: ${user.messages.toLocaleString()}, Cost: ₹${user.cost.toLocaleString()}`);
    });

    console.log(`\n📊 CAMPAIGN STATUS BREAKDOWN`);
    console.log(`─────────────────────────────────────`);
    activeStatusBreakdown.forEach(status => {
      console.log(`${status._id}: ${status.count}`);
    });

    // ==================== ARCHIVED CAMPAIGNS ====================
    console.log('\n\n🔵 ARCHIVED CAMPAIGNS (Moved to Archive)');
    console.log('─'.repeat(80));

    const archivedCampaigns = await ArchivedCampaign.aggregate([
      { $match: { campaignCreatedAt: { $gte: startDate, $lte: endDate } } },
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

    const archivedTopUsers = await ArchivedCampaign.aggregate([
      { $match: { campaignCreatedAt: { $gte: startDate, $lte: endDate } } },
      { $group: { _id: '$userId', count: { $sum: 1 }, totalMessages: { $sum: '$stats.total' }, totalCost: { $sum: '$actualCost' } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $unwind: '$user' },
      { $project: { name: '$user.name', email: '$user.email', campaigns: '$count', messages: '$totalMessages', cost: '$totalCost' } }
    ]);

    const archived = archivedCampaigns[0] || { totalCampaigns: 0, totalMessages: 0, totalSent: 0, totalDelivered: 0, totalRead: 0, totalFailed: 0, totalExpired: 0, totalCost: 0, totalRefunded: 0 };

    console.log('\n📈 OVERALL STATISTICS');
    console.log('─────────────────────────────────────');
    console.log(`Total Campaigns: ${archived.totalCampaigns.toLocaleString()}`);
    console.log(`\nTotal Messages: ${archived.totalMessages.toLocaleString()}`);
    console.log(`  - Sent: ${archived.totalSent.toLocaleString()} (${((archived.totalSent / archived.totalMessages) * 100 || 0).toFixed(2)}%)`);
    console.log(`  - Delivered: ${archived.totalDelivered.toLocaleString()} (${((archived.totalDelivered / archived.totalMessages) * 100 || 0).toFixed(2)}%)`);
    console.log(`  - Read: ${archived.totalRead.toLocaleString()} (${((archived.totalRead / archived.totalMessages) * 100 || 0).toFixed(2)}%)`);
    console.log(`  - Failed: ${archived.totalFailed.toLocaleString()} (${((archived.totalFailed / archived.totalMessages) * 100 || 0).toFixed(2)}%)`);
    console.log(`  - Expired: ${archived.totalExpired.toLocaleString()} (${((archived.totalExpired / archived.totalMessages) * 100 || 0).toFixed(2)}%)`);
    
    console.log(`\n💰 FINANCIAL SUMMARY`);
    console.log(`─────────────────────────────────────`);
    console.log(`Total Cost: ₹${archived.totalCost.toLocaleString()}`);
    console.log(`Total Refunded: ₹${archived.totalRefunded.toLocaleString()}`);
    console.log(`Net Revenue: ₹${(archived.totalCost - archived.totalRefunded).toLocaleString()}`);

    console.log(`\n👥 TOP 5 USERS BY CAMPAIGNS`);
    console.log(`─────────────────────────────────────`);
    if (archivedTopUsers.length > 0) {
      archivedTopUsers.forEach((user, i) => {
        console.log(`${i + 1}. ${user.name} (${user.email})`);
        console.log(`   Campaigns: ${user.campaigns}, Messages: ${user.messages.toLocaleString()}, Cost: ₹${user.cost.toLocaleString()}`);
      });
    } else {
      console.log('No archived campaigns found for this period');
    }

    // ==================== COMBINED SUMMARY ====================
    console.log('\n\n📊 COMBINED SUMMARY (Active + Archived)');
    console.log('═'.repeat(80));

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

    console.log(`\nTotal Campaigns: ${combined.totalCampaigns.toLocaleString()}`);
    console.log(`  - Active: ${active.totalCampaigns.toLocaleString()} (${((active.totalCampaigns / combined.totalCampaigns) * 100 || 0).toFixed(2)}%)`);
    console.log(`  - Archived: ${archived.totalCampaigns.toLocaleString()} (${((archived.totalCampaigns / combined.totalCampaigns) * 100 || 0).toFixed(2)}%)`);

    console.log(`\nTotal Messages: ${combined.totalMessages.toLocaleString()}`);
    console.log(`  - Active: ${active.totalMessages.toLocaleString()} (${((active.totalMessages / combined.totalMessages) * 100 || 0).toFixed(2)}%)`);
    console.log(`  - Archived: ${archived.totalMessages.toLocaleString()} (${((archived.totalMessages / combined.totalMessages) * 100 || 0).toFixed(2)}%)`);

    console.log(`\nDelivery Rate: ${((combined.totalDelivered / combined.totalMessages) * 100 || 0).toFixed(2)}%`);
    console.log(`  - Active: ${((active.totalDelivered / active.totalMessages) * 100 || 0).toFixed(2)}%`);
    console.log(`  - Archived: ${((archived.totalDelivered / archived.totalMessages) * 100 || 0).toFixed(2)}%`);

    console.log(`\nRead Rate: ${((combined.totalRead / combined.totalMessages) * 100 || 0).toFixed(2)}%`);
    console.log(`  - Active: ${((active.totalRead / active.totalMessages) * 100 || 0).toFixed(2)}%`);
    console.log(`  - Archived: ${((archived.totalRead / archived.totalMessages) * 100 || 0).toFixed(2)}%`);

    console.log(`\nFailure Rate: ${((combined.totalFailed / combined.totalMessages) * 100 || 0).toFixed(2)}%`);
    console.log(`  - Active: ${((active.totalFailed / active.totalMessages) * 100 || 0).toFixed(2)}%`);
    console.log(`  - Archived: ${((archived.totalFailed / archived.totalMessages) * 100 || 0).toFixed(2)}%`);

    console.log(`\n💰 COMBINED FINANCIAL SUMMARY`);
    console.log(`─────────────────────────────────────`);
    console.log(`Total Cost: ₹${combined.totalCost.toLocaleString()}`);
    console.log(`  - Active: ₹${active.totalCost.toLocaleString()}`);
    console.log(`  - Archived: ₹${archived.totalCost.toLocaleString()}`);
    console.log(`\nTotal Refunded: ₹${combined.totalRefunded.toLocaleString()}`);
    console.log(`  - Active: ₹${active.totalRefunded.toLocaleString()}`);
    console.log(`  - Archived: ₹${archived.totalRefunded.toLocaleString()}`);
    console.log(`\nNet Revenue: ₹${(combined.totalCost - combined.totalRefunded).toLocaleString()}`);
    console.log(`  - Active: ₹${(active.totalCost - active.totalRefunded).toLocaleString()}`);
    console.log(`  - Archived: ₹${(archived.totalCost - archived.totalRefunded).toLocaleString()}`);

    console.log('\n✅ Separate monthly stats generated successfully\n');

  } catch (error) {
    console.error('❌ Error generating separate monthly stats:', error);
  } finally {
    await closeConnection();
    process.exit(0);
  }
}

// Get month from command line argument (default: 1 = last month)
const monthsBack = parseInt(process.argv[2]) || 1;
getSeparateMonthlyStats(monthsBack);
