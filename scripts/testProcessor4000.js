import dotenv from 'dotenv';
import mongoose from 'mongoose';
import MessageLogProcessor from '../src/services/MessageLogProcessor.js';

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

async function test() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected\n');

    const db = mongoose.connection.db;

    // Create 4000 test logs
    console.log('Creating 4000 test logs...');
    const testLogs = [];
    const testUserId = new mongoose.Types.ObjectId();
    const testCampaignId = new mongoose.Types.ObjectId();

    for (let i = 0; i < 4000; i++) {
      testLogs.push({
        messageId: `test_${Date.now()}_${i}`,
        campaignId: testCampaignId,
        userId: testUserId,
        eventType: 'status_update',
        status: 'success',
        webhookData: {
          eventType: 'SEND_MESSAGE_FAILURE',
          phoneNumber: '+919999999999',
          rawPayload: { entity: { error: { code: 'TEST' } } }
        },
        processed: false,
        timestamp: new Date()
      });
    }

    await db.collection('message_logs').insertMany(testLogs);
    console.log('✅ Created 4000 test logs\n');

    // Check before
    const before = await db.collection('message_logs').countDocuments({ processed: false });
    console.log(`Before: ${before} unprocessed\n`);

    // Process
    console.log('Starting processor...\n');
    const start = Date.now();
    
    await MessageLogProcessor.processAllPending();
    
    const duration = ((Date.now() - start) / 1000).toFixed(2);

    // Check after
    const after = await db.collection('message_logs').countDocuments({ processed: false });
    const processed = before - after;

    console.log('\n=== RESULTS ===');
    console.log(`Processed: ${processed} logs`);
    console.log(`Remaining: ${after} unprocessed`);
    console.log(`Time: ${duration} seconds`);
    console.log(`Rate: ${Math.round(processed / duration)} logs/sec`);

    if (after === 0) {
      console.log('\n✅ SUCCESS: All logs processed!');
    } else {
      console.log(`\n⚠️  ${after} logs still unprocessed`);
    }

    // Cleanup
    await db.collection('message_logs').deleteMany({ messageId: { $regex: /^test_/ } });
    console.log('\n✅ Cleaned up test logs');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

test();
