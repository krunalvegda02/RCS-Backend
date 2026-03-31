import mongoose from "mongoose";
import app from "../app.js";

const connectDB = async (retries = 5, delay = 5000) => {
  for (let i = 0; i < retries; i++) {
    try {
      // Set mongoose options before connecting - M30 optimized
      mongoose.set('strictQuery', false);
      mongoose.set('bufferCommands', false);
      mongoose.set('maxTimeMS', 30000);        // 30 second query timeout for M30
      mongoose.set('sanitizeFilter', true);    // Enable filter sanitization
      mongoose.set('runValidators', true);     // Run validators on updates
      
      const connectionInstance = await mongoose.connect(
        process.env.MONGODB_URI,
        {
          // Connection timeouts - M30 optimized
          serverSelectionTimeoutMS: 20000, // 20 seconds (M30 can handle longer)
          connectTimeoutMS: 20000,         // 20 seconds
          socketTimeoutMS: 0,              // No timeout for long operations
          
          // Connection pool settings - M30 optimized (up to 500 connections)
          maxPoolSize: 50,                 // Higher pool for M30 (50 per service)
          minPoolSize: 10,                 // Higher minimum pool
          maxIdleTimeMS: 60000,            // Keep connections longer (1 minute)
          
          // Replica set settings - M30 optimized
          readPreference: 'primaryPreferred', // Allow secondary reads for better performance
          retryWrites: true,               // Retry failed writes
          retryReads: true,                // Retry failed reads
          
          // Write concern - M30 optimized
          w: 'majority',                   // Acknowledge writes to majority
          wtimeout: 15000,                 // 15 seconds for write acknowledgment
          j: true,                         // Wait for journal commit (M30 has faster storage)
          
          // Read concern - M30 optimized
          readConcern: { level: 'majority' }, // Consistent reads
          
          // Network settings - M30 optimized
          family: 4,                       // Use IPv4
          heartbeatFrequencyMS: 10000,     // Send heartbeat every 10 seconds
          
          // M30 specific optimizations
          maxStalenessSeconds: 90,         // Allow slightly stale reads for performance
          compressors: ['zlib'],           // Enable compression for better network usage
        }
      );

      // Express error handling
      app.on("error", (error) => {
        console.log("Express Error:", error);
      });

      // Success logging
      console.log('Backend Database:', mongoose.connection.db.databaseName);
      console.log('Backend Host:', mongoose.connection.host);
      console.log(' MOngoDB connected !! DB HOST:', mongoose.connection.host);
      console.log(
        "✅--------- MongoDB Connected Successfully for RCS Messaging Project ✅------",
      );
      return;
      
    } catch (error) {
      console.error(
        `❌ MongoDB Connection Failed (attempt ${i + 1}/${retries}):`,
        error.message,
      );
      
      // Enhanced error logging
      if (error.name === 'MongoServerSelectionError') {
        console.error('🔴 Server Selection Error - Check if MongoDB Atlas is accessible');
        console.error('🔴 Verify IP whitelist and connection string');
      } else if (error.name === 'MongoParseError') {
        console.error('🔴 Connection String Parse Error - Check MONGODB_URI format');
      } else if (error.name === 'MongoNetworkError') {
        console.error('🔴 Network Error - Check internet connection and firewall');
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
  console.warn("⚠️ MongoDB disconnected. Attempting reconnect in 10s...");
  setTimeout(() => {
    connectDB(3, 10000); // 3 retries with 10s initial delay
  }, 10000);
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