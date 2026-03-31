import mongoose from "mongoose";
import app from "../app.js";

const connectDB = async (retries = 5, delay = 5000) => {
  for (let i = 0; i < retries; i++) {
    try {
      const connectionInstance = await mongoose.connect(
        `${process.env.MONGODB_URI}`,
        {
          serverSelectionTimeoutMS: 15000,
          connectTimeoutMS: 15000,
          socketTimeoutMS: 45000,
          heartbeatFrequencyMS: 5000,
          family: 4, // Force IPv4 — fixes EAI_AGAIN & timeouts
          maxPoolSize: 50,  // Reduced for better connection management
          minPoolSize: 10,   // Lower minimum pool
          maxIdleTimeMS: 30000,
          retryWrites: true,
          retryReads: true,
          writeConcern: { w: 'majority', wtimeout: 10000 }, // Use majority for Atlas
          readConcern: { level: 'majority' }, // Use majority for Atlas
          readPreference: 'primaryPreferred', // Prefer primary but allow secondary
          bufferCommands: false, // Disable mongoose buffering
          bufferMaxEntries: 0    // Disable mongoose buffering
        }
      );

      mongoose.set('debug', false);
      mongoose.set('strictQuery', false);

      app.on("error", (error) => {
        console.log("Express Error:", error);
      });

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
      console.error('Error details:', {
        name: error.name,
        code: error.code,
        reason: error.reason?.type
      });

      if (i < retries - 1) {
        console.log(`⏳ Retrying in ${delay / 1000}s...`);
        await new Promise((res) => setTimeout(res, delay));
        delay *= 1.5; // Exponential backoff
      } else {
        console.error("🚨 All retry attempts exhausted. Exiting.");
        process.exit(1);
      }
    }
  }
};

// Auto-reconnect on unexpected disconnect
mongoose.connection.on("disconnected", () => {
  console.warn("⚠️ MongoDB disconnected. Attempting reconnect in 5s...");
  setTimeout(() => connectDB(), 5000);
});

mongoose.connection.on("error", (err) => {
  console.error("❌ MongoDB runtime error:", err.message);
});

mongoose.connection.on("connected", () => {
  console.log("🔗 MongoDB connection established");
});

mongoose.connection.on("reconnected", () => {
  console.log("🔄 MongoDB reconnected successfully");
});

export default connectDB;