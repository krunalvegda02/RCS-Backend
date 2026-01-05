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
    status: String
  }],
  stats: mongoose.Schema.Types.Mixed,
  completedAt: Date
}, { timestamps: true, collection: 'campaigns' }));

async function completeStuckCampaigns() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const runningCampaigns = await Campaign.find({ 
      status: { $in: ['running', 'processing'] } 
    });
    
    console.log(`📊 Found ${runningCampaigns.length} running/processing campaigns\n`);

    for (const campaign of runningCampaigns) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`📋 Campaign: ${campaign.name}`);
      console.log(`🆔 ID: ${campaign._id}`);
      console.log(`📊 Status: ${campaign.status}`);

      // Count recipient statuses
      const statusCounts = {};
      campaign.recipients.forEach(r => {
        statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
      });

      console.log('\n📈 Recipient Status:');
      Object.entries(statusCounts).forEach(([status, count]) => {
        console.log(`  ${status}: ${count}`);
      });

      // Check if there are any pending/processing/queued recipients
      const stillPending = campaign.recipients.filter(r => 
        r.status === 'pending' || r.status === 'processing' || r.status === 'queued'
      );

      if (stillPending.length === 0) {
        console.log('\n🔄 No pending recipients, marking as completed...');
        
        campaign.status = 'completed';
        campaign.completedAt = new Date();
        
        // Recalculate stats
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
        console.log('   Campaign will continue processing');
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

completeStuckCampaigns();
