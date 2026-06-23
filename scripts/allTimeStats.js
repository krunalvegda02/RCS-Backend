import { connectWithRetry, closeConnection, setupGracefulShutdown } from './mongoConnection.js';
import mongoose from 'mongoose';

setupGracefulShutdown();

async function getAllTimeStats() {
  try {
    await connectWithRetry();
    console.log('Connected to MongoDB\n');

    // Import models
    const Campaign = (await import('../src/models/campaign.model.js')).default;
    const ArchivedCampaign = (await import('../src/models/archivedCampaign.model.js')).default;

    console.log('\n📊 ALL-TIME CAMPAIGN STATISTICS (Matching AdminReports)\n');
    console.log('═'.repeat(80));

    // Active campaigns - ALL TIME
    const activeCampaigns = await Campaign.aggregate([
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
          totalExpired: { $sum: '$stats.expired' }
        }
      }
    ]);

    // Archived campaigns - ALL TIME
    const archivedCampaigns = await ArchivedCampaign.aggregate([
      {
        $group: {
          _id: null,
          totalCampaigns: { $sum: 1 },
          totalMessages: { $sum: '$stats.total' },
          totalSent: { $sum: '$stats.sent' },
          totalDelivered: { $sum: '$stats.delivered' },
          totalRead: { $sum: '$stats.read' },
          totalFailed: { $sum: '$stats.failed' },
          totalExpired: { $sum: '$stats.expired' }
        }
      }
    ]);

    const active = activeCampaigns[0] || { totalCampaigns: 0, totalMessages: 0, totalSent: 0, totalDelivered: 0, totalRead: 0, totalReplied: 0, totalFailed: 0, totalExpired: 0 };
    const archived = archivedCampaigns[0] || { totalCampaigns: 0, totalMessages: 0, totalSent: 0, totalDelivered: 0, totalRead: 0, totalFailed: 0, totalExpired: 0 };

    console.log('\n🟢 ACTIVE CAMPAIGNS (All Time)');
    console.log('─────────────────────────────────────');
    console.log(`Total Campaigns: ${active.totalCampaigns.toLocaleString()}`);
    console.log(`Total Messages: ${active.totalMessages.toLocaleString()}`);
    console.log(`Total Sent: ${active.totalSent.toLocaleString()}`);
    console.log(`Total Delivered: ${active.totalDelivered.toLocaleString()}`);
    console.log(`Total Read: ${active.totalRead.toLocaleString()}`);
    console.log(`Total Replied: ${(active.totalReplied || 0).toLocaleString()}`);
    console.log(`Total Failed: ${active.totalFailed.toLocaleString()}`);
    console.log(`Total Expired: ${active.totalExpired.toLocaleString()}`);

    console.log('\n🔵 ARCHIVED CAMPAIGNS (All Time)');
    console.log('─────────────────────────────────────');
    console.log(`Total Campaigns: ${archived.totalCampaigns.toLocaleString()}`);
    console.log(`Total Messages: ${archived.totalMessages.toLocaleString()}`);
    console.log(`Total Sent: ${archived.totalSent.toLocaleString()}`);
    console.log(`Total Delivered: ${archived.totalDelivered.toLocaleString()}`);
    console.log(`Total Read: ${archived.totalRead.toLocaleString()}`);
    console.log(`Total Failed: ${archived.totalFailed.toLocaleString()}`);
    console.log(`Total Expired: ${archived.totalExpired.toLocaleString()}`);

    console.log('\n📊 COMBINED TOTALS (Active + Archived)');
    console.log('═'.repeat(80));
    console.log(`Total Campaigns: ${(active.totalCampaigns + archived.totalCampaigns).toLocaleString()}`);
    console.log(`Total Messages: ${(active.totalMessages + archived.totalMessages).toLocaleString()}`);
    console.log(`Total Sent: ${(active.totalSent + archived.totalSent).toLocaleString()}`);
    console.log(`Total Delivered: ${(active.totalDelivered + archived.totalDelivered).toLocaleString()}`);
    console.log(`Total Read: ${(active.totalRead + archived.totalRead).toLocaleString()}`);
    console.log(`Total Replied: ${((active.totalReplied || 0) + (archived.totalReplied || 0)).toLocaleString()}`);
    console.log(`Total Failed: ${(active.totalFailed + archived.totalFailed).toLocaleString()}`);
    console.log(`Total Expired: ${(active.totalExpired + archived.totalExpired).toLocaleString()}`);

    console.log('\n✅ All-time stats generated successfully\n');

  } catch (error) {
    console.error('❌ Error generating all-time stats:', error);
  } finally {
    await closeConnection();
    process.exit(0);
  }
}

getAllTimeStats();
