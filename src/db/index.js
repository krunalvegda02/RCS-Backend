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
          // Connection timeouts - Production optimized
          serverSelectionTimeoutMS: 60000, // 60 seconds for production
          connectTimeoutMS: 60000,         // 60 seconds for initial connection
          socketTimeoutMS: 0,              // No timeout for long operations
          
          // Connection pool settings - Production optimized
          maxPoolSize: 20,                 // Conservative for production stability
          minPoolSize: 5,                  // Minimum pool
          maxIdleTimeMS: 300000,           // Keep connections for 5 minutes
          
          // Replica set settings - Production optimized
          readPreference: 'primary',       // Primary only for production consistency
          retryWrites: true,               // Retry failed writes
          retryReads: true,                // Retry failed reads
          
          // Write concern - Production safe (fixed deprecated options)
          writeConcern: {
            w: 1,                          // Single node acknowledgment (faster)
            wtimeoutMS: 30000             // 30 seconds (not wtimeout)
          },
          
          // Network settings - Production optimized
          family: 4,                       // Use IPv4
          heartbeatFrequencyMS: 30000,     // Heartbeat every 30 seconds
          
          // Production specific settings
          ssl: true,                       // Ensure SSL is enabled
          authSource: 'admin'              // Specify auth source
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