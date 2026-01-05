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

async function syncCampaignStatuses() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const campaigns = await Campaign.find({});
    console.log(`📊 Found ${campaigns.length} campaigns\n`);

    for (const campaign of campaigns) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`📋 Campaign: ${campaign.name}`);
      console.log(`🆔 ID: ${campaign._id}`);
      console.log(`📊 Current Status: ${campaign.status}`);

      // Get all messages for this campaign
      const messages = await Message.find({ campaignId: campaign._id });
      console.log(`📨 Found ${messages.length} messages`);

      if (messages.length === 0) {
        console.log('⚠️  No messages found, skipping');
        continue;
      }

      // Create a map of phone number to message
      const messageMap = {};
      messages.forEach(msg => {
        const phone = msg.recipientPhoneNumber.replace(/^\+91/, '').replace(/^\+/, '');
        messageMap[phone] = msg;
      });

      let updated = 0;
      // Update each recipient with actual message status
      for (const recipient of campaign.recipients) {
        const phone = recipient.phoneNumber.replace(/^\+91/, '').replace(/^\+/, '');
        const message = messageMap[phone];

        if (message) {
          const oldStatus = recipient.status;
          recipient.status = message.status;
          recipient.messageId = message.messageId;
          
          if (message.sentAt) recipient.sentAt = message.sentAt;
          if (message.deliveredAt) recipient.deliveredAt = message.deliveredAt;
          if (message.readAt) recipient.readAt = message.readAt;
          
          if (oldStatus !== message.status) {
            console.log(`  📱 ${phone}: ${oldStatus} → ${message.status}`);
            updated++;
          }
        }
      }

      console.log(`\n✅ Updated ${updated} recipients`);

      // Recalculate stats
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

      console.log('\n📈 New Recipient Status:');
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

      if (newStatus !== campaign.status) {
        console.log(`\n🔄 Updating campaign status: ${campaign.status} → ${newStatus}`);
        campaign.status = newStatus;
        if (newStatus === 'completed' && !campaign.completedAt) {
          campaign.completedAt = new Date();
        }
      }

      // Update stats
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

      console.log('\n✅ Campaign synced successfully!');
      console.log(`  Sent: ${stats.sent}`);
      console.log(`  Delivered: ${stats.delivered}`);
      console.log(`  Read: ${stats.read}`);
      console.log(`  Success Rate: ${stats.successRate.toFixed(2)}%`);
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log('\n✅ All campaigns synced!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

syncCampaignStatuses();
