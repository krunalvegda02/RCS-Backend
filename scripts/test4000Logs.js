import dotenv from 'dotenv';
import mongoose from 'mongoose';
import MessageLog from '../src/models/messageLog.model.js';
import ContactCampaignMessage from '../src/models/message.model.js';
import MessageLogProcessor from '../src/services/MessageLogProcessor.js';

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

async function test4000Logs() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to database\n');

    // Step 1: Check current unprocessed count
    console.log('=== STEP 1: Initial State ===');
    const initialUnprocessed = await MessageLog.countDocuments({ processed: false });
    console.log(`Unprocessed logs: ${initialUnprocessed}\n`);

    if (initialUnprocessed === 0) {
      console.log('⚠️  No unprocessed logs found. Creating 4000 test logs...\n');
      
      // Get a real message to use as template
      const sampleMessage = await ContactCampaignMessage.findOne({
        'campaigns.messageId': { $exists: true }
      }).lean();

      if (!sampleMessage) {
        console.log('❌ No messages found in database. Cannot create test logs.');
        process.exit(1);
      }

      const campaign = sampleMessage.campaigns[0];
      const testLogs = [];

      for (let i = 0; i < 4000; i++) {
        testLogs.push({
          messageId: `test_${Date.now()}_${i}`,
          campaignId: campaign.campaignId,
          userId: sampleMessage.userId,
          eventType: 'status_update',
          status: 'success',
          webhookData: {
            eventType: 'SEND_MESSAGE_FAILURE',
            phoneNumber: sampleMessage.phoneNumber,
            rawPayload: {
              entity: {
                messageId: `test_${Date.now()}_${i}`,
                eventType: 'SEND_MESSAGE_FAILURE',
                error: { code: 'TEST', message: 'Test failure' }
              }
            }
          },
          processed: false,
          timestamp: new Date(),
          metadata: { source: 'webhook', note: 'Test log' }
        });
      }

      await MessageLog.insertMany(testLogs);
      console.log('✅ Created 4000 test logs\n');
    }

    // Step 2: Count unprocessed before processing
    const beforeCount = await MessageLog.countDocuments({ processed: false });
    console.log('=== STEP 2: Before Processing ===');
    console.log(`Unprocessed logs: ${beforeCount}\n`);

    // Step 3: Run processor
    console.log('=== STEP 3: Running Processor ===');
    const startTime = Date.now();
    
    await MessageLogProcessor.processAllPending();
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\nProcessing completed in ${duration} seconds\n`);

    // Step 4: Count unprocessed after processing
    console.log('=== STEP 4: After Processing ===');
    const afterCount = await MessageLog.countDocuments({ processed: false });
    const processedCount = beforeCount - afterCount;
    
    console.log(`Unprocessed logs: ${afterCount}`);
    console.log(`Processed: ${processedCount} logs`);
    console.log(`Processing rate: ${Math.round(processedCount / duration)} logs/sec\n`);

    // Step 5: Verify
    console.log('=== STEP 5: Verification ===');
    if (afterCount === 0) {
      console.log('✅ SUCCESS: All logs processed!');
      console.log(`✅ Processor handled ${processedCount} logs correctly`);
    } else {
      console.log(`⚠️  WARNING: ${afterCount} logs still unprocessed`);
      console.log('   Processor may have stopped early or encountered errors');
    }

    // Cleanup test logs
    if (initialUnprocessed === 0) {
      console.log('\n=== Cleanup ===');
      await MessageLog.deleteMany({ 
        messageId: { $regex: /^test_/ },
        'metadata.note': 'Test log'
      });
      console.log('✅ Cleaned up test logs');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

test4000Logs();
