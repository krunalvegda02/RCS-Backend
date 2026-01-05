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

async function fixCampaignStatus(campaignId) {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      console.error('❌ Campaign not found');
      process.exit(1);
    }

    console.log('\n📊 Current Campaign Status:');
    console.log('Name:', campaign.name);
    console.log('Status:', campaign.status);
    console.log('Total Recipients:', campaign.recipients.length);

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

    console.log('\n📈 Recipient Status Breakdown:');
    Object.entries(statusCounts).forEach(([status, count]) => {
      if (count > 0) console.log(`  ${status}: ${count}`);
    });

    // Determine correct campaign status
    const hasDelivered = statusCounts.delivered > 0 || statusCounts.read > 0 || statusCounts.replied > 0;
    const hasPending = statusCounts.pending > 0 || statusCounts.processing > 0 || statusCounts.queued > 0;

    let newStatus = campaign.status;
    if (hasDelivered && !hasPending) {
      newStatus = 'completed';
    } else if (hasDelivered && hasPending) {
      newStatus = 'running';
    }

    console.log('\n🔄 Updating Campaign...');
    console.log('New Status:', newStatus);

    // Update campaign
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

    console.log('\n✅ Campaign Updated Successfully!');
    console.log('\n📊 New Stats:');
    console.log('  Total:', stats.total);
    console.log('  Sent:', stats.sent);
    console.log('  Delivered:', stats.delivered);
    console.log('  Read:', stats.read);
    console.log('  Failed:', stats.failed);
    console.log('  Success Rate:', stats.successRate.toFixed(2) + '%');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

const campaignId = process.argv[2];
if (!campaignId) {
  console.log('Usage: node scripts/fixCampaignStatus.js <campaignId>');
  process.exit(1);
}

fixCampaignStatus(campaignId);
