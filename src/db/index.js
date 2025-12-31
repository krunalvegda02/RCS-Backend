import mongoose from "mongoose";
import app from "../app.js";

const connectDB = async () => {
  try {
    const connectionInstance = await mongoose.connect(
      `${process.env.MONGODB_URI}`,
      {
        serverSelectionTimeoutMS: 30000,
        socketTimeoutMS: 45000,
        maxPoolSize: 10,
        minPoolSize: 5
      }
    );
    app.on("error", () => {
      console.log("Express Error:", error);
    });

    console.log('Backend Database:', mongoose.connection.name);
    console.log('Backend Host:', mongoose.connection.host);

    console.log(`\n MOngoDB connected !! DB HOST: ${connectionInstance.connection.host}`);
    // console.log("ConnectionInstance :", connectionInstance.connection);

  } catch (error) {
    console.log("Database connectivity error:", error);
    process.exit(1);
  }
};

export default connectDB;
