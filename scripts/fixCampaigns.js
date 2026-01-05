#!/usr/bin/env node
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const Message = mongoose.model('Message', new mongoose.Schema({
  messageId: String,
  campaignId: mongoose.Schema.Types.ObjectId,
  status: String,
  recipientPhoneNumber: String,
  sentAt: Date,
  deliveredAt: Date,
  readAt: Date
}, { timestamps: true, collection: 'messages' }));

const Campaign = mongoose.model('Campaign', new mongoose.Schema({
  name: String,
  status: String,
  recipients: [{
    phoneNumber: String,
    messageId: String,
    status: String,
    sentAt: Date,
    deliveredAt: Date,
    readAt: Date,
    failedAt: Date,
    failureReason: String
  }],
  stats: mongoose.Schema.Types.Mixed,
  completedAt: Date
}, { timestamps: true, collection: 'campaigns' }));

async function fixCampaigns() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const campaigns = await Campaign.find({ status: { $in: ['running', 'processing'] } });
    console.log(`📊 Found ${campaigns.length} running/processing campaigns\n`);

    if (campaigns.length === 0) {
      console.log('✅ No campaigns to fix!');
      process.exit(0);
    }

    for (const campaign of campaigns) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`📋 Campaign: ${campaign.name}`);
      console.log(`🆔 ID: ${campaign._id}`);

      // Get messages for this campaign
      const messages = await Message.find({ campaignId: campaign._id });
      console.log(`📨 Found ${messages.length} messages`);

      // Create phone map
      const messageMap = {};
      messages.forEach(msg => {
        const phone = msg.recipientPhoneNumber.replace(/^\+91/, '').replace(/^\+/, '');
        messageMap[phone] = msg;
      });

      // Update recipients with actual message status
      let updated = 0;
      for (const recipient of campaign.recipients) {
        const phone = recipient.phoneNumber.replace(/^\+91/, '').replace(/^\+/, '');
        const message = messageMap[phone];

        if (message && recipient.status !== message.status) {
          recipient.status = message.status;
          recipient.messageId = message.messageId;
          if (message.sentAt) recipient.sentAt = message.sentAt;
          if (message.deliveredAt) recipient.deliveredAt = message.deliveredAt;
          if (message.readAt) recipient.readAt = message.readAt;
          console.log(`  📱 ${phone}: ${recipient.status} → ${message.status}`);
          updated++;
        }
      }

      console.log(`\n✅ Updated ${updated} recipients`);

      // Count statuses
      const statusCounts = {};
      campaign.recipients.forEach(r => {
        statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
      });

      console.log('\n📈 Recipient Status:');
      Object.entries(statusCounts).forEach(([status, count]) => {
        if (count > 0) console.log(`  ${status}: ${count}`);
      });

      // Check if should be completed
      const stillPending = campaign.recipients.filter(r => 
        r.status === 'pending' || r.status === 'processing' || r.status === 'queued'
      );

      if (stillPending.length === 0) {
        console.log('\n🔄 Marking as completed...');
        campaign.status = 'completed';
        campaign.completedAt = new Date();

        // Update stats
        const stats = {
          total: campaign.recipients.length,
          pending: 0,
          processing: 0,
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

        console.log('✅ Campaign completed!');
        console.log(`  Success Rate: ${stats.successRate.toFixed(2)}%`);
      } else {
        console.log(`\n⚠️  ${stillPending.length} recipients still pending/processing/queued`);
      }
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log('\n✅ Done!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

fixCampaigns();
