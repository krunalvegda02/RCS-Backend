#!/usr/bin/env node
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
    isRcsCapable: Boolean
  }],
  stats: mongoose.Schema.Types.Mixed,
  completedAt: Date
}, { timestamps: true, collection: 'campaigns' }));

async function updateCampaignStats(campaign) {
  const statusCounts = {
    pending: 0,
    processing: 0,
    sent: 0,
    delivered: 0,
    read: 0,
    replied: 0,
    failed: 0,
    bounced: 0
  };

  campaign.recipients.forEach(r => {
    if (statusCounts.hasOwnProperty(r.status)) {
      statusCounts[r.status]++;
    }
  });

  const stats = {
    total: campaign.recipients.length,
    pending: statusCounts.pending,
    processing: statusCounts.processing,
    sent: statusCounts.sent + statusCounts.delivered + statusCounts.read + statusCounts.replied,
    delivered: statusCounts.delivered + statusCounts.read + statusCounts.replied,
    read: statusCounts.read + statusCounts.replied,
    replied: statusCounts.replied,
    failed: statusCounts.failed,
    bounced: statusCounts.bounced,
    rcsCapable: campaign.recipients.filter(r => r.isRcsCapable === true).length,
  };

  stats.successRate = stats.total > 0 ? (stats.delivered / stats.total) * 100 : 0;
  stats.failureRate = stats.total > 0 ? ((stats.failed + stats.bounced) / stats.total) * 100 : 0;
  stats.lastUpdatedAt = new Date();

  campaign.stats = stats;
  await campaign.save();
}

async function fixStats() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const campaigns = await Campaign.find({ status: 'completed' });
    console.log(`📊 Found ${campaigns.length} completed campaigns\n`);

    let fixed = 0;
    for (const campaign of campaigns) {
      // Count actual recipient statuses
      const statusCounts = {};
      campaign.recipients.forEach(r => {
        statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
      });

      // Check if stats are wrong
      const actualFailed = statusCounts.failed || 0;
      const currentFailed = campaign.stats?.failed || 0;

      if (actualFailed !== currentFailed) {
        console.log(`\n📋 ${campaign.name} (${campaign._id})`);
        console.log(`   Current stats.failed: ${currentFailed}`);
        console.log(`   Actual failed count: ${actualFailed}`);
        console.log(`   Fixing...`);

        await updateCampaignStats(campaign);
        fixed++;
        console.log(`   ✅ Fixed!`);
      }
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`\n✅ Fixed ${fixed} campaigns`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

fixStats();
