import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') });

export async function connectWithRetry(retries = 3, delay = 5000) {
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`🔄 MongoDB connection attempt ${i + 1}/${retries}...`);
      
      // Set mongoose options
      mongoose.set('strictQuery', false);
      
      await mongoose.connect(process.env.MONGODB_URI, {
        // Connection timeouts - Production optimized
        serverSelectionTimeoutMS: 60000, // 60 seconds
        connectTimeoutMS: 60000,         // 60 seconds
        socketTimeoutMS: 0,              // No timeout for long operations
        
        // Connection pool settings
        maxPoolSize: 10,                 // Reasonable pool for scripts
        minPoolSize: 2,                  // Minimum pool
        maxIdleTimeMS: 300000,           // 5 minutes
        
        // Replica set settings
        readPreference: 'primaryPreferred', // Allow secondary reads
        retryWrites: true,
        retryReads: true,
        
        // Write concern
        writeConcern: {
          w: 1,
          wtimeoutMS: 30000
        },
        
        // Network settings - DNS optimized
        family: 4,                       // Force IPv4 - fixes DNS issues
        heartbeatFrequencyMS: 30000,     // 30 second heartbeat
        
        // SSL and auth
        ssl: true,
        authSource: 'admin',
        
        // Connection optimizations
        maxConnecting: 2,
        waitQueueTimeoutMS: 30000
      });
      
      console.log('✅ MongoDB connected successfully');
      console.log(`📊 Database: ${mongoose.connection.db.databaseName}`);
      console.log(`🏠 Host: ${mongoose.connection.host}`);
      return;
      
    } catch (error) {
      console.error(`❌ Connection attempt ${i + 1} failed:`, error.message);
      
      // Enhanced error logging
      if (error.code === 'EAI_AGAIN' || error.message.includes('getaddrinfo')) {
        console.error('🔴 DNS resolution error - network/DNS issue');
      } else if (error.name === 'MongoServerSelectionError') {
        console.error('🔴 Server selection error - MongoDB cluster may be busy');
      } else if (error.code === 'ESERVFAIL' || error.message.includes('querySrv')) {
        console.error('🔴 DNS/SRV lookup failed - temporary network issue');
      } else if (error.name === 'MongoNetworkTimeoutError') {
        console.error('🔴 Network timeout - connection is slow');
      }
      
      if (i < retries - 1) {
        const nextDelay = delay * Math.pow(1.5, i); // Exponential backoff
        console.log(`⏳ Retrying in ${nextDelay / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, nextDelay));
      } else {
        throw new Error(`Failed to connect after ${retries} attempts: ${error.message}`);
      }
    }
  }
}

export async function closeConnection() {
  try {
    await mongoose.connection.close();
    console.log('🔌 MongoDB connection closed');
  } catch (error) {
    console.error('❌ Error closing connection:', error.message);
  }
}

// Graceful shutdown handlers
export function setupGracefulShutdown() {
  process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT, shutting down gracefully...');
    await closeConnection();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    await closeConnection();
    process.exit(0);
  });

  process.on('uncaughtException', async (error) => {
    console.error('❌ Uncaught exception:', error.message);
    await closeConnection();
    process.exit(1);
  });

  process.on('unhandledRejection', async (reason) => {
    console.error('❌ Unhandled rejection:', reason);
    await closeConnection();
    process.exit(1);
  });
}

export default { connectWithRetry, closeConnection, setupGracefulShutdown };