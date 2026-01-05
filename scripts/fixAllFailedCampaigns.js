import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const Campaign = mongoose.model('Campaign', new mongoose.Schema({
  name: String,
  status: String,
  recipients: [{
    phoneNumber: String,
    status: String,
    sentAt: Date,
    deliveredAt: Date,
    readAt: Date,
    failedAt: Date
  }],
  stats: mongoose.Schema.Types.Mixed,
  completedAt: Date
}, { timestamps: true, collection: 'campaigns' }));

async function fixAllFailedCampaigns() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Find all campaigns marked as failed
    const failedCampaigns = await Campaign.find({ status: 'failed' });
    console.log(`📊 Found ${failedCampaigns.length} campaigns marked as "failed"\n`);

    if (failedCampaigns.length === 0) {
      console.log('✅ No failed campaigns to fix!');
      process.exit(0);
    }

    let fixedCount = 0;

    for (const campaign of failedCampaigns) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`📋 Campaign: ${campaign.name}`);
      console.log(`🆔 ID: ${campaign._id}`);
      console.log(`📅 Created: ${campaign.createdAt?.toLocaleString()}`);

      // Count recipient statuses
      const statusCounts = {
        pending: 0,
        processing: 0,
        queued: 0,
        sent: 0,
        delivered: 0,
        read: 0,
        replied: 0,
        failed: 0
      };

      campaign.recipients.forEach(r => {
        statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
      });

      console.log('\n📈 Recipient Status:');
      Object.entries(statusCounts).forEach(([status, count]) => {
        if (count > 0) console.log(`  ${status}: ${count}`);
      });

      // Check if campaign has any successful deliveries
      const hasDelivered = statusCounts.delivered > 0 || statusCounts.read > 0 || statusCounts.replied > 0;
      const hasPending = statusCounts.pending > 0 || statusCounts.processing > 0 || statusCounts.queued > 0;

      if (hasDelivered) {
        // Campaign should be marked as completed, not failed
        const newStatus = hasPending ? 'running' : 'completed';
        
        console.log(`\n🔄 Fixing campaign status: failed → ${newStatus}`);
        
        campaign.status = newStatus;
        if (newStatus === 'completed' && !campaign.completedAt) {
          campaign.completedAt = new Date();
        }

        // Recalculate stats
        const stats = {
          total: campaign.recipients.length,
          pending: statusCounts.pending || 0,
          processing: statusCounts.processing || 0,
          sent: (statusCounts.sent || 0) + (statusCounts.delivered || 0) + (statusCounts.read || 0) + (statusCounts.replied || 0),
          delivered: (statusCounts.delivered || 0) + (statusCounts.read || 0) + (statusCounts.replied || 0),
          read: (statusCounts.read || 0) + (statusCounts.replied || 0),
          replied: statusCounts.replied || 0,
          failed: statusCounts.failed || 0,
          bounced: 0
        };

        stats.successRate = stats.total > 0 ? (stats.delivered / stats.total) * 100 : 0;
        stats.failureRate = stats.total > 0 ? (stats.failed / stats.total) * 100 : 0;
        stats.lastUpdatedAt = new Date();

        campaign.stats = stats;
        await campaign.save();

        console.log('✅ Campaign fixed!');
        console.log(`  Delivered: ${stats.delivered}`);
        console.log(`  Success Rate: ${stats.successRate.toFixed(2)}%`);
        fixedCount++;
      } else {
        console.log('\n⚠️  No delivered messages - keeping as failed');
      }
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`\n✅ Fixed ${fixedCount} out of ${failedCampaigns.length} campaigns`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

fixAllFailedCampaigns();
