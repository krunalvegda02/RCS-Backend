import { connectWithRetry, closeConnection, setupGracefulShutdown } from './mongoConnection.js';
import mongoose from 'mongoose';
import { Kafka } from 'kafkajs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from parent directory
dotenv.config({ path: join(__dirname, '..', '.env') });

// Setup graceful shutdown
setupGracefulShutdown();

async function pushUnprocessedLogsRobust() {
  try {
    console.log('🚀 Starting robust unprocessed logs push to Kafka...');
    
    // Connect with retry logic
    await connectWithRetry();

    const MessageLog = (await import('../src/models/messageLog.model.js')).default;

    // Count unprocessed logs
    const count = await MessageLog.countDocuments({ processed: false });
    console.log(`📊 Found ${count} unprocessed logs`);

    if (count === 0) {
      console.log('✅ No unprocessed logs found');
      await closeConnection();
      process.exit(0);
    }

    // Initialize Kafka with retry logic
    const kafka = new Kafka({
      clientId: 'log-pusher-robust',
      brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
      connectionTimeout: 30000,
      requestTimeout: 30000,
      retry: {
        initialRetryTime: 300,
        retries: 5,
        maxRetryTime: 30000,
        multiplier: 2
      }
    });

    const producer = kafka.producer({
      maxInFlightRequests: 5,
      idempotent: false,
      transactionTimeout: 30000,
      retry: {
        initialRetryTime: 300,
        retries: 5,
        maxRetryTime: 30000,
        multiplier: 2
      }
    });

    console.log('🔄 Connecting to Kafka...');
    await producer.connect();
    console.log('✅ Kafka producer connected');

    // Process in batches with progress tracking
    const BATCH_SIZE = 1000;
    let processed = 0;
    let skip = 0;
    let errors = 0;

    while (skip < count) {
      try {
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

        const progress = Math.round((processed / count) * 100);
        console.log(`📤 Progress: ${processed}/${count} (${progress}%) - Batch of ${logs.length} sent`);

        // Small delay to avoid overwhelming systems
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (batchError) {
        console.error(`❌ Batch error at ${skip}:`, batchError.message);
        errors++;
        
        // Skip this batch and continue
        skip += BATCH_SIZE;
        
        // If too many errors, abort
        if (errors > 5) {
          console.error('🚨 Too many batch errors, aborting');
          break;
        }
        
        // Wait longer before next batch
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    await producer.disconnect();
    console.log(`✅ Successfully pushed ${processed} logs to Kafka`);
    console.log(`⚠️  Encountered ${errors} batch errors`);
    console.log('💡 Stats consumers will now process these logs');

    await closeConnection();
    process.exit(0);

  } catch (error) {
    console.error('❌ Script error:', error.message);
    
    // Enhanced error reporting
    if (error.message.includes('Failed to connect')) {
      console.error('🔴 MongoDB connection failed completely');
      console.error('🔴 Check network connectivity and MongoDB Atlas status');
    } else if (error.message.includes('Kafka')) {
      console.error('🔴 Kafka connection/operation failed');
      console.error('🔴 Check if Kafka broker is running and accessible');
    }
    
    await closeConnection();
    process.exit(1);
  }
}



pushUnprocessedLogsRobust();