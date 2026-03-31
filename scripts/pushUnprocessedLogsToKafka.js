import mongoose from 'mongoose';
import { Kafka } from 'kafkajs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { connectWithRetry, closeConnection, setupGracefulShutdown } from './mongoConnection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from parent directory
dotenv.config({ path: join(__dirname, '..', '.env') });

async function pushUnprocessedLogs() {
  try {
    console.log('🚀 Starting unprocessed logs push to Kafka...');
    
    // Connect to MongoDB with robust settings
    await connectWithRetry();

    const MessageLog = (await import('../src/models/messageLog.model.js')).default;

    // Count unprocessed logs
    const count = await MessageLog.countDocuments({ processed: false });
    console.log(`📊 Found ${count} unprocessed logs`);

    if (count === 0) {
      console.log('✅ No unprocessed logs found');
      process.exit(0);
    }

    // Initialize Kafka
    const kafka = new Kafka({
      clientId: 'log-pusher',
      brokers: [process.env.KAFKA_BROKER || 'localhost:9092']
    });

    const producer = kafka.producer();
    await producer.connect();
    console.log('✅ Kafka producer connected');

    // Process in batches
    const BATCH_SIZE = 1000;
    let processed = 0;
    let skip = 0;

    while (skip < count) {
      const logs = await MessageLog.find({ processed: false })
        .select('_id')
        .limit(BATCH_SIZE)
        .skip(skip)
        .lean();

      if (logs.length === 0) break;

      // Send to Kafka with key for even distribution
      const messages = logs.map(log => ({
        key: log._id.toString(),
        value: JSON.stringify({ logId: log._id.toString() })
      }));

      await producer.send({
        topic: 'message-stats',
        messages
      });

      processed += logs.length;
      skip += BATCH_SIZE;

      console.log(`📤 Pushed ${processed}/${count} logs to Kafka (${Math.round((processed/count)*100)}%)`);

      // Small delay to avoid overwhelming Kafka
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    await producer.disconnect();
    console.log(`✅ Successfully pushed ${processed} logs to Kafka`);
    console.log('💡 Stats consumers will now process these logs');

    await closeConnection();
    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error);
    await closeConnection();
    process.exit(1);
  }
}

// Setup graceful shutdown
setupGracefulShutdown();

pushUnprocessedLogs();
