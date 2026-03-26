import mongoose from "mongoose";
import app from "../app.js";

const connectDB = async () => {
  try {
    const connectionInstance = await mongoose.connect(
      `${process.env.MONGODB_URI}`,
      {
        serverSelectionTimeoutMS: 30000,
        socketTimeoutMS: 120000,
        connectTimeoutMS: 30000,
        maxPoolSize: 80,  // Reduced for M20 cluster (80 * 5 services = 400 connections)
        minPoolSize: 20,  // Adequate minimum pool
        maxIdleTimeMS: 30000, // Reduced idle time
        retryWrites: true,
        retryReads: true,
        writeConcern: { w: 1, wtimeout: 5000 }, // Fast writes
        readConcern: { level: 'local' } // Fast reads
      }
    );

    mongoose.set('debug', false);
    mongoose.set('strictQuery', false);

    app.on("error", (error) => {
      console.log("Express Error:", error);
    });

    console.log('Backend Database:', mongoose.connection.name);
    console.log('Backend Host:', mongoose.connection.host);

    console.log(`\n MOngoDB connected !! DB HOST: ${connectionInstance.connection.host}`);

  } catch (error) {
    console.log("Database connectivity error:", error);
    process.exit(1);
  }
};

export default connectDB;
