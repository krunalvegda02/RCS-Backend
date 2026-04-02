import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function analyzeFailedMessages() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const Campaign = (await import('../src/models/campaign.model.js')).default;
    const ContactCampaignMessage = (await import('../src/models/contactMessage.model.js')).default;
    const MessageLog = (await import('../src/models/messageLog.model.js')).default;

    const campaignId = '69cbd26e6a73a08e733dd8d7';
    const campaign = await Campaign.findById(campaignId);

    if (!campaign) {
      console.error(`❌ Campaign not found`);
      process.exit(1);
    }

    console.log(`\n📋 Campaign: ${campaign.name}`);
    console.log(`   ID: ${campaign._id}\n`);

    // Get sample of failed messages
    const failedMessages = await ContactCampaignMessage.find({
      campaignId: campaign._id,
      status: 'failed'
    })
    .select('messageId recipientPhoneNumber status errorCode errorMessage')
    .limit(100)
    .lean();

    console.log(`🔍 Analyzing ${failedMessages.length} failed messages (sample)...\n`);

    const messageIds = failedMessages.map(m => m.messageId);

    // Get ALL webhooks for these messages
    const allLogs = await MessageLog.find({
      messageId: { $in: messageIds }
    })
    .select('messageId webhookData.eventType timestamp')
    .lean();

    console.log(`📊 Found ${allLogs.length} total webhook logs for sample\n`);

    // Group by event type
    const eventTypeCounts = {};
    for (const log of allLogs) {
      const eventType = log.webhookData?.eventType || 'UNKNOWN';
      eventTypeCounts[eventType] = (eventTypeCounts[eventType] || 0) + 1;
    }

    console.log('📈 Webhook Event Type Distribution:');
    for (const [eventType, count] of Object.entries(eventTypeCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`   ${eventType}: ${count}`);
    }

    // Check specific messages
    console.log('\n🔎 Sample Message Analysis:\n');
    
    for (let i = 0; i < Math.min(10, failedMessages.length); i++) {
      const msg = failedMessages[i];
      const logs = allLogs.filter(l => l.messageId === msg.messageId);
      
      console.log(`Message ${i + 1}:`);
      console.log(`  Phone: ${msg.recipientPhoneNumber}`);
      console.log(`  MessageID: ${msg.messageId}`);
      console.log(`  Status: ${msg.status}`);
      console.log(`  Error: ${msg.errorCode || 'N/A'} - ${msg.errorMessage || 'N/A'}`);
      console.log(`  Webhooks (${logs.length}):`);
      
      if (logs.length === 0) {
        console.log(`    ⚠️  NO WEBHOOKS FOUND`);
      } else {
        for (const log of logs) {
          console.log(`    - ${log.webhookData?.eventType || 'UNKNOWN'} at ${new Date(log.timestamp).toISOString()}`);
        }
      }
      console.log('');
    }

    // Check if there are messages with NO webhooks at all
    const messagesWithNoLogs = [];
    for (const msg of failedMessages) {
      const hasLogs = allLogs.some(l => l.messageId === msg.messageId);
      if (!hasLogs) {
        messagesWithNoLogs.push(msg);
      }
    }

    console.log(`\n⚠️  Messages with NO webhooks: ${messagesWithNoLogs.length}/${failedMessages.length}`);

    // Check for SEND_MESSAGE_FAILURE webhooks
    const failureWebhooks = await MessageLog.find({
      messageId: { $in: messageIds },
      'webhookData.eventType': { $in: ['SEND_MESSAGE_FAILURE', 'MESSAGE_EXPIRED', 'MESSAGE_REVOKED'] }
    })
    .select('messageId webhookData')
    .lean();

    console.log(`\n❌ Failure webhooks found: ${failureWebhooks.length}`);
    
    if (failureWebhooks.length > 0) {
      console.log('\nSample failure reasons:');
      for (let i = 0; i < Math.min(5, failureWebhooks.length); i++) {
        const log = failureWebhooks[i];
        const error = log.webhookData?.rawPayload?.entity?.error;
        console.log(`  ${i + 1}. ${log.webhookData?.eventType}: ${error?.code || 'N/A'} - ${error?.message || 'N/A'}`);
      }
    }

    // Check for SUCCESS webhooks that might have been missed
    const successWebhooks = await MessageLog.find({
      messageId: { $in: messageIds },
      'webhookData.eventType': { $in: ['MESSAGE_SENT', 'SEND_MESSAGE_SUCCESS', 'MESSAGE_DELIVERED', 'MESSAGE_READ'] }
    })
    .select('messageId webhookData.eventType')
    .lean();

    console.log(`\n✅ Success webhooks found: ${successWebhooks.length}`);
    
    const successByType = {};
    for (const log of successWebhooks) {
      const type = log.webhookData?.eventType;
      successByType[type] = (successByType[type] || 0) + 1;
    }
    
    console.log('   Breakdown:');
    for (const [type, count] of Object.entries(successByType)) {
      console.log(`   - ${type}: ${count}`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('💡 ANALYSIS SUMMARY:');
    console.log('='.repeat(60));
    
    if (messagesWithNoLogs.length > 50) {
      console.log(`⚠️  ${messagesWithNoLogs.length} messages have NO webhooks at all`);
      console.log('   → These messages were never sent or webhooks were not received');
    }
    
    if (failureWebhooks.length > successWebhooks.length) {
      console.log(`❌ More failure webhooks (${failureWebhooks.length}) than success (${successWebhooks.length})`);
      console.log('   → These messages genuinely failed to deliver');
    }
    
    if (successWebhooks.length > 0) {
      console.log(`✅ ${successWebhooks.length} messages have success webhooks but are marked failed`);
      console.log('   → These need to be reprocessed (already done by previous script)');
    }

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

analyzeFailedMessages();
