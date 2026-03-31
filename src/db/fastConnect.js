import mongoose from "mongoose";
import app from "../app.js";

// Alternative connection method for DNS issues
const connectDBDirect = async (retries = 3, delay = 3000) => {
  for (let i = 0; i < retries; i++) {
    try {
      // Set mongoose options before connecting
      mongoose.set('strictQuery', false);
      mongoose.set('bufferCommands', false);
      
      // Extract connection details from SRV string for direct connection
      const mongoUri = process.env.MONGODB_URI;
      
      // If SRV connection fails, try direct connection to known hosts
      let connectionString = mongoUri;
      
      // For Atlas clusters, we can try direct connection to known hosts
      if (mongoUri.includes('mongodb+srv://') && i > 0) {
        // Replace SRV with direct connection to known Atlas hosts
        const directHosts = [
          'cluster0-shard-00-00.whqwih.mongodb.net:27017',
          'cluster0-shard-00-01.whqwih.mongodb.net:27017',
          'cluster0-shard-00-02.whqwih.mongodb.net:27017'
        ];
        
        const credentials = mongoUri.match(/mongodb\+srv:\/\/([^@]+)@/)?.[1];
        const database = mongoUri.match(/\/([^?]+)/)?.[1];
        const params = mongoUri.includes('?') ? mongoUri.split('?')[1] : '';
        
        if (credentials && database) {
          connectionString = `mongodb://${credentials}@${directHosts.join(',')}/${database}?${params}&replicaSet=atlas-j82okk-shard-0`;
          console.log(`🔄 Attempt ${i + 1}: Trying direct connection (bypassing SRV)`);
        }
      }
      
      const connectionInstance = await mongoose.connect(
        connectionString,
        {
          // Faster connection settings
          serverSelectionTimeoutMS: 15000, // 15 seconds
          connectTimeoutMS: 15000,         // 15 seconds
          socketTimeoutMS: 0,              // No timeout
          
          // Connection pool
          maxPoolSize: 10,                 // Smaller pool for faster connection
          minPoolSize: 2,                  // Minimum pool
          maxIdleTimeMS: 60000,            // 1 minute idle
          
          // Replica set settings
          readPreference: 'primaryPreferred',
          retryWrites: true,
          retryReads: true,
          
          // Fast write concern
          writeConcern: {
            w: 1,
            wtimeoutMS: 5000
          },
          
          // Network optimizations
          family: 4,                       // IPv4 only
          heartbeatFrequencyMS: 10000,     // 10 second heartbeat
          
          // Connection optimizations
          maxConnecting: 2,
          waitQueueTimeoutMS: 5000,
          
          // SSL and auth
          ssl: true,
          authSource: 'admin'
        }
      );

      // Express error handling
      app.on("error", (error) => {
        console.log("Express Error:", error);
      });

      // Success logging
      if (mongoose.connection && mongoose.connection.db) {
        console.log('Backend Database:', mongoose.connection.db.databaseName);
        console.log('Backend Host:', mongoose.connection.host);
        console.log(' MOngoDB connected !! DB HOST:', mongoose.connection.host);
      }
      console.log("✅ Fast MongoDB Connection Established!");
      return;
      
    } catch (error) {
      console.error(`❌ Connection attempt ${i + 1}/${retries} failed:`, error.message);
      
      if (error.code === 'ESERVFAIL' || error.message.includes('querySrv')) {
        console.error('🔴 DNS/SRV lookup failed - will try direct connection next');
      }
      
      if (i < retries - 1) {
        console.log(`⏳ Retrying in ${delay / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 1.2; // Slight increase in delay
      } else {
        console.error("🚨 All connection attempts failed. Exiting.");
        process.exit(1);
      }
    }
  }
};

// Connection event handlers (same as before)
mongoose.connection.on("connected", () => {
  console.log("🔗 MongoDB connection established");
});

mongoose.connection.on("disconnected", () => {
  console.warn("⚠️ MongoDB disconnected. Attempting reconnect in 5s...");
  setTimeout(() => {
    connectDBDirect(2, 3000); // Quick reconnect
  }, 5000);
});

mongoose.connection.on("reconnected", () => {
  console.log("🔄 MongoDB reconnected successfully");
});

mongoose.connection.on("error", (err) => {
  console.error("❌ MongoDB runtime error:", err.message);
  
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

export default connectDBDirect;