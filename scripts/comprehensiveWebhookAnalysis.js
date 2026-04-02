import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function comprehensiveWebhookAnalysis() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const Campaign = (await import('../src/models/campaign.model.js')).default;
    const ContactCampaignMessage = (await import('../src/models/contactMessage.model.js')).default;
    const MessageLog = (await import('../src/models/messageLog.model.js')).default;

    const campaignId = '69cbd26e6a73a08e733dd8d7';
    const campaign = await Campaign.findById(campaignId);

    if (!campaign) {
      console.error(`❌ Campaign not found`);
      process.exit(1);
    }

    console.log(`📋 Campaign: ${campaign.name}`);
    console.log(`   ID: ${campaign._id}\n`);

    // Get ALL messages for this campaign
    console.log('🔍 Fetching all campaign messages...');
    const allMessages = await ContactCampaignMessage.find({
      campaignId: campaign._id
    })
    .select('messageId status')
    .lean();

    console.log(`   Total messages: ${allMessages.length.toLocaleString()}\n`);

    // Get ALL messageIds
    const allMessageIds = allMessages.map(m => m.messageId);

    // Count messages by current status
    const statusCounts = {};
    for (const msg of allMessages) {
      statusCounts[msg.status] = (statusCounts[msg.status] || 0) + 1;
    }

    console.log('📊 Current Status Distribution:');
    for (const [status, count] of Object.entries(statusCounts).sort((a, b) => b[1] - a[1])) {
      const pct = ((count / allMessages.length) * 100).toFixed(1);
      console.log(`   ${status}: ${count.toLocaleString()} (${pct}%)`);
    }

    // Now check ALL webhooks for ALL messages
    console.log('\n🔎 Analyzing ALL webhook logs (this may take a moment)...\n');

    // Process in batches to avoid memory issues
    const BATCH_SIZE = 5000;
    const webhookStats = {
      messagesWithWebhooks: 0,
      messagesWithoutWebhooks: 0,
      successWebhooks: 0,
      failureWebhooks: 0,
      deliveredWebhooks: 0,
      readWebhooks: 0,
      sentWebhooks: 0,
      messagesWithSuccess: new Set(),
      messagesWithOnlyFailure: new Set(),
      messagesWithNoWebhooks: new Set()
    };

    for (let i = 0; i < allMessageIds.length; i += BATCH_SIZE) {
      const batchIds = allMessageIds.slice(i, i + BATCH_SIZE);
      
      console.log(`   Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(allMessageIds.length / BATCH_SIZE)}...`);

      // Get all webhooks for this batch
      const webhooks = await MessageLog.find({
        messageId: { $in: batchIds }
      })
      .select('messageId webhookData.eventType')
      .lean();

      // Group webhooks by messageId
      const webhooksByMessage = {};
      for (const webhook of webhooks) {
        if (!webhooksByMessage[webhook.messageId]) {
          webhooksByMessage[webhook.messageId] = [];
        }
        webhooksByMessage[webhook.messageId].push(webhook.webhookData?.eventType);
      }

      // Analyze each message in this batch
      for (const messageId of batchIds) {
        const messageWebhooks = webhooksByMessage[messageId] || [];

        if (messageWebhooks.length === 0) {
          webhookStats.messagesWithoutWebhooks++;
          webhookStats.messagesWithNoWebhooks.add(messageId);
        } else {
          webhookStats.messagesWithWebhooks++;

          // Check for success webhooks
          const hasSuccess = messageWebhooks.some(e => 
            ['MESSAGE_SENT', 'SEND_MESSAGE_SUCCESS', 'MESSAGE_DELIVERED', 'MESSAGE_READ'].includes(e)
          );
          const hasFailure = messageWebhooks.some(e => 
            ['SEND_MESSAGE_FAILURE', 'MESSAGE_EXPIRED', 'MESSAGE_REVOKED'].includes(e)
          );

          if (hasSuccess) {
            webhookStats.messagesWithSuccess.add(messageId);
          }

          if (hasFailure && !hasSuccess) {
            webhookStats.messagesWithOnlyFailure.add(messageId);
          }

          // Count specific webhook types
          for (const eventType of messageWebhooks) {
            if (eventType === 'MESSAGE_READ') webhookStats.readWebhooks++;
            else if (eventType === 'MESSAGE_DELIVERED') webhookStats.deliveredWebhooks++;
            else if (['MESSAGE_SENT', 'SEND_MESSAGE_SUCCESS'].includes(eventType)) webhookStats.sentWebhooks++;
            else if (['SEND_MESSAGE_FAILURE', 'MESSAGE_EXPIRED', 'MESSAGE_REVOKED'].includes(eventType)) webhookStats.failureWebhooks++;
          }
        }
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log('📊 COMPREHENSIVE WEBHOOK ANALYSIS RESULTS');
    console.log('='.repeat(70));

    console.log('\n🔍 Message Coverage:');
    console.log(`   Messages with webhooks: ${webhookStats.messagesWithWebhooks.toLocaleString()} (${((webhookStats.messagesWithWebhooks / allMessages.length) * 100).toFixed(1)}%)`);
    console.log(`   Messages without webhooks: ${webhookStats.messagesWithoutWebhooks.toLocaleString()} (${((webhookStats.messagesWithoutWebhooks / allMessages.length) * 100).toFixed(1)}%)`);

    console.log('\n✅ Success Analysis:');
    console.log(`   Messages with SUCCESS webhooks: ${webhookStats.messagesWithSuccess.size.toLocaleString()} (${((webhookStats.messagesWithSuccess.size / allMessages.length) * 100).toFixed(1)}%)`);
    console.log(`   Messages with ONLY failure webhooks: ${webhookStats.messagesWithOnlyFailure.size.toLocaleString()} (${((webhookStats.messagesWithOnlyFailure.size / allMessages.length) * 100).toFixed(1)}%)`);

    console.log('\n📈 Webhook Type Counts:');
    console.log(`   SENT webhooks: ${webhookStats.sentWebhooks.toLocaleString()}`);
    console.log(`   DELIVERED webhooks: ${webhookStats.deliveredWebhooks.toLocaleString()}`);
    console.log(`   READ webhooks: ${webhookStats.readWebhooks.toLocaleString()}`);
    console.log(`   FAILURE webhooks: ${webhookStats.failureWebhooks.toLocaleString()}`);

    console.log('\n' + '='.repeat(70));
    console.log('💡 TRUTH vs CURRENT STATE');
    console.log('='.repeat(70));

    const currentFailed = statusCounts['failed'] || 0;
    const shouldBeSuccess = webhookStats.messagesWithSuccess.size;
    const shouldBeFailed = webhookStats.messagesWithOnlyFailure.size;
    const noWebhooks = webhookStats.messagesWithNoWebhooks.size;

    console.log('\n📊 What the data shows:');
    console.log(`   Messages that SHOULD be successful: ${shouldBeSuccess.toLocaleString()} (${((shouldBeSuccess / allMessages.length) * 100).toFixed(1)}%)`);
    console.log(`   Messages that SHOULD be failed: ${shouldBeFailed.toLocaleString()} (${((shouldBeFailed / allMessages.length) * 100).toFixed(1)}%)`);
    console.log(`   Messages with NO webhooks: ${noWebhooks.toLocaleString()} (${((noWebhooks / allMessages.length) * 100).toFixed(1)}%)`);

    console.log('\n📊 Current database state:');
    console.log(`   Currently marked as sent/delivered/read: ${(statusCounts['sent'] || 0) + (statusCounts['delivered'] || 0) + (statusCounts['read'] || 0)} (${(((statusCounts['sent'] || 0) + (statusCounts['delivered'] || 0) + (statusCounts['read'] || 0)) / allMessages.length * 100).toFixed(1)}%)`);
    console.log(`   Currently marked as failed: ${currentFailed.toLocaleString()} (${((currentFailed / allMessages.length) * 100).toFixed(1)}%)`);

    const discrepancy = currentFailed - shouldBeFailed;
    if (discrepancy > 0) {
      console.log(`\n⚠️  DISCREPANCY FOUND:`);
      console.log(`   ${discrepancy.toLocaleString()} messages are marked as FAILED but have SUCCESS webhooks!`);
      console.log(`   These need to be reprocessed.`);
    } else {
      console.log(`\n✅ Database state matches webhook data!`);
    }

    console.log('\n' + '='.repeat(70));

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

comprehensiveWebhookAnalysis();
