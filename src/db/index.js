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
        maxPoolSize: 50,
        minPoolSize: 10,
        maxIdleTimeMS: 60000,
        retryWrites: true,
        retryReads: true
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
