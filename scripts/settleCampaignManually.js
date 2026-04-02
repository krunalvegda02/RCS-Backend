import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function settleCampaignManually() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Import all models
    const Campaign = (await import('../src/models/campaign.model.js')).default;
    const User = (await import('../src/models/user.model.js')).default;
    const ContactCampaignMessage = (await import('../src/models/contactMessage.model.js')).default;
    const MessageLog = (await import('../src/models/messageLog.model.js')).default;

    console.log('═'.repeat(70));
    console.log('🔧 MANUAL CAMPAIGN SETTLEMENT');
    console.log('═'.repeat(70));
    console.log('\nOptions:');
    console.log('1. Settle by Campaign Name');
    console.log('2. Settle by Campaign ID');
    console.log('3. Settle all campaigns by User ID');
    console.log('4. Exit\n');

    const choice = await question('Enter your choice (1-4): ');

    let campaigns = [];

    switch (choice.trim()) {
      case '1': {
        const name = await question('\nEnter campaign name (or partial name): ');
        campaigns = await Campaign.find({
          name: new RegExp(name, 'i'),
          status: { $in: ['completed', 'running', 'processing'] }
        }).sort({ createdAt: -1 });
        
        if (campaigns.length === 0) {
          console.log('\n❌ No campaigns found with that name');
          rl.close();
          await mongoose.connection.close();
          process.exit(0);
        }

        console.log(`\n📋 Found ${campaigns.length} campaign(s):\n`);
        campaigns.forEach((c, i) => {
          console.log(`${i + 1}. ${c.name} (ID: ${c._id})`);
          console.log(`   Status: ${c.status}`);
          console.log(`   Total: ${c.stats?.total || 0}, Sent: ${c.stats?.sent || 0}`);
          console.log(`   Blocked: ₹${c.blockedAmount || 0}\n`);
        });

        const selectAll = await question('Settle all these campaigns? (yes/no): ');
        if (selectAll.toLowerCase() !== 'yes') {
          const index = await question('Enter campaign number to settle (or 0 to cancel): ');
          const idx = parseInt(index) - 1;
          if (idx >= 0 && idx < campaigns.length) {
            campaigns = [campaigns[idx]];
          } else {
            console.log('\n❌ Cancelled');
            rl.close();
            await mongoose.connection.close();
            process.exit(0);
          }
        }
        break;
      }

      case '2': {
        const id = await question('\nEnter campaign ID: ');
        const campaign = await Campaign.findById(id.trim());
        
        if (!campaign) {
          console.log('\n❌ Campaign not found');
          rl.close();
          await mongoose.connection.close();
          process.exit(0);
        }

        console.log(`\n📋 Campaign: ${campaign.name}`);
        console.log(`   Status: ${campaign.status}`);
        console.log(`   Total: ${campaign.stats?.total || 0}, Sent: ${campaign.stats?.sent || 0}`);
        console.log(`   Blocked: ₹${campaign.blockedAmount || 0}\n`);

        campaigns = [campaign];
        break;
      }

      case '3': {
        const userId = await question('\nEnter User ID: ');
        campaigns = await Campaign.find({
          userId: userId.trim(),
          status: { $in: ['completed', 'running', 'processing'] }
        }).sort({ createdAt: -1 });

        if (campaigns.length === 0) {
          console.log('\n❌ No campaigns found for this user');
          rl.close();
          await mongoose.connection.close();
          process.exit(0);
        }

        console.log(`\n📋 Found ${campaigns.length} campaign(s) for user:\n`);
        campaigns.forEach((c, i) => {
          console.log(`${i + 1}. ${c.name} (ID: ${c._id})`);
          console.log(`   Status: ${c.status}`);
          console.log(`   Total: ${c.stats?.total || 0}, Sent: ${c.stats?.sent || 0}`);
          console.log(`   Blocked: ₹${c.blockedAmount || 0}\n`);
        });

        const confirm = await question('Settle all these campaigns? (yes/no): ');
        if (confirm.toLowerCase() !== 'yes') {
          console.log('\n❌ Cancelled');
          rl.close();
          await mongoose.connection.close();
          process.exit(0);
        }
        break;
      }

      case '4':
        console.log('\n✅ Exiting...');
        rl.close();
        await mongoose.connection.close();
        process.exit(0);

      default:
        console.log('\n❌ Invalid choice');
        rl.close();
        await mongoose.connection.close();
        process.exit(0);
    }

    // Settle campaigns
    console.log('\n' + '═'.repeat(70));
    console.log('🔧 SETTLING CAMPAIGNS');
    console.log('═'.repeat(70) + '\n');

    let totalSettled = 0;
    let totalRefunded = 0;
    let totalCharged = 0;

    for (const campaign of campaigns) {
      console.log(`\n📋 Processing: ${campaign.name}`);
      console.log(`   Campaign ID: ${campaign._id}`);
      console.log(`   Current Status: ${campaign.status}\n`);

      try {
        // Sync stats first
        console.log('   🔄 Syncing stats...');
        await campaign.syncStats();
        console.log(`   ✅ Stats synced: Total=${campaign.stats.total}, Sent=${campaign.stats.sent}, Failed=${campaign.stats.failed}`);

        // Settle campaign
        console.log('   💰 Settling wallet...');
        const result = await campaign.completeCampaign();
        
        console.log(`   ✅ Settlement complete:`);
        console.log(`      Charged: ₹${result.actualCost}`);
        console.log(`      Refunded: ₹${result.refundAmount}`);
        console.log(`      Messages charged: ${result.sent}`);
        console.log(`      Failed (not charged): ${result.failed}`);

        totalSettled++;
        totalRefunded += result.refundAmount;
        totalCharged += result.actualCost;

      } catch (error) {
        console.error(`   ❌ Error settling campaign: ${error.message}`);
      }
    }

    console.log('\n' + '═'.repeat(70));
    console.log('📊 SETTLEMENT SUMMARY');
    console.log('═'.repeat(70));
    console.log(`\n✅ Campaigns settled: ${totalSettled}/${campaigns.length}`);
    console.log(`💰 Total charged: ₹${totalCharged}`);
    console.log(`💸 Total refunded: ₹${totalRefunded}`);
    console.log(`📈 Net amount: ₹${totalCharged - totalRefunded}\n`);

    console.log('✅ Settlement completed successfully!\n');

    rl.close();
    await mongoose.connection.close();
    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error);
    rl.close();
    await mongoose.connection.close();
    process.exit(1);
  }
}

settleCampaignManually();
