import mongoose from "mongoose";
import app from "../app.js";

const connectDB = async (retries = 5, delay = 5000) => {
  for (let i = 0; i < retries; i++) {
    try {
      // Set minimal mongoose options to avoid query casting issues
      mongoose.set('strictQuery', false);  // Allow flexible queries
      
      const connectionInstance = await mongoose.connect(
        process.env.MONGODB_URI,
        {
          // Connection timeouts - Optimized for faster connection
          serverSelectionTimeoutMS: 30000, // 30 seconds
          connectTimeoutMS: 30000,         // 30 seconds
          socketTimeoutMS: 0,              // No timeout for long operations
          
          // Connection pool settings - Optimized
          maxPoolSize: 20,                 // Conservative pool size
          minPoolSize: 5,                  // Minimum pool
          maxIdleTimeMS: 300000,           // Keep connections for 5 minutes
          
          // Replica set settings - Optimized for speed
          readPreference: 'primaryPreferred', // Allow secondary if primary slow
          retryWrites: true,               // Retry failed writes
          retryReads: true,                // Retry failed reads
          
          // Write concern - Fast and reliable
          writeConcern: {
            w: 1,                          // Single node acknowledgment (fastest)
            wtimeoutMS: 30000             // 10 seconds timeout
          },
          
          // Network settings - DNS optimized
          family: 4,                       // Force IPv4 (prevents DNS issues)
          heartbeatFrequencyMS: 10000,     // Heartbeat every 10 seconds
          
          // DNS and connection optimizations
          directConnection: false,         // Use SRV records (but with optimizations)
          ssl: true,                       // SSL enabled
          authSource: 'admin',             // Auth source
          
          // Additional optimizations for faster connection
          maxConnecting: 2,                // Limit concurrent connections
          waitQueueTimeoutMS: 10000,       // Wait queue timeout
          
          // Disable compression for faster initial connection
          compressors: []                  // No compression for speed
        }
      );

      // Express error handling
      app.on("error", (error) => {
        console.log("Express Error:", error);
      });

      // Success logging - Fixed undefined error
      if (mongoose.connection && mongoose.connection.db) {
        console.log('Backend Database:', mongoose.connection.db.databaseName);
        console.log('Backend Host:', mongoose.connection.host);
        console.log(' MOngoDB connected !! DB HOST:', mongoose.connection.host);
      } else {
        console.log('MongoDB connected successfully (database info not available yet)');
      }
      console.log(
        "✅--------- MongoDB Connected Successfully for RCS Messaging Project ✅------",
      );
      return;
      
    } catch (error) {
      console.error(
        `❌ MongoDB Connection Failed (attempt ${i + 1}/${retries}):`,
        error.message,
      );
      
      // Enhanced error logging with DNS-specific handling
      if (error.name === 'MongoServerSelectionError') {
        console.error('🔴 Server Selection Error - Check if MongoDB Atlas is accessible');
        console.error('🔴 Verify IP whitelist and connection string');
      } else if (error.name === 'MongoParseError') {
        console.error('🔴 Connection String Parse Error - Check MONGODB_URI format');
      } else if (error.name === 'MongoNetworkError') {
        console.error('🔴 Network Error - Check internet connection and firewall');
      } else if (error.code === 'ESERVFAIL' || error.message.includes('querySrv')) {
        console.error('🔴 DNS Resolution Error - MongoDB Atlas SRV record lookup failed');
        console.error('🔴 This is usually a temporary network/DNS issue');
      } else if (error.name === 'MongoNetworkTimeoutError') {
        console.error('🔴 Network Timeout - Connection is slow or unstable');
      }
      
      console.error('Error details:', {
        name: error.name,
        code: error.code,
        codeName: error.codeName
      });

      if (i < retries - 1) {
        const nextDelay = Math.min(delay * Math.pow(1.5, i), 30000); // Cap at 30 seconds
        console.log(`⏳ Retrying in ${nextDelay / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, nextDelay));
      } else {
        console.error("🚨 All retry attempts exhausted. Exiting.");
        process.exit(1);
      }
    }
  }
};

// Connection event handlers
mongoose.connection.on("connected", () => {
  console.log("🔗 MongoDB connection established");
});

mongoose.connection.on("disconnected", () => {
  console.warn("⚠️ MongoDB disconnected. Attempting reconnect in 5s...");
  setTimeout(() => {
    connectDB(3, 5000); // 3 retries with 5s initial delay (faster reconnect)
  }, 5000);
});

mongoose.connection.on("reconnected", () => {
  console.log("🔄 MongoDB reconnected successfully");
});

mongoose.connection.on("error", (err) => {
  console.error("❌ MongoDB runtime error:", err.message);
  
  // Don't exit on runtime errors, just log them
  if (err.name === 'MongoNetworkTimeoutError') {
    console.error('🔴 Network timeout - connection may be unstable');
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Received SIGINT. Gracefully shutting down MongoDB connection...');
  await mongoose.connection.close();
  console.log('✅ MongoDB connection closed.');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM. Gracefully shutting down MongoDB connection...');
  await mongoose.connection.close();
  console.log('✅ MongoDB connection closed.');
  process.exit(0);
});

export default connectDB;