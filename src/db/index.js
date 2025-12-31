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
    
    // Test backend database access
    const Message = mongoose.model('Message');
    const backendCount = await Message.countDocuments();
    console.log(`🔍 Backend sees ${backendCount} messages in database`);
    
    // Check all databases on this connection
    const admin = mongoose.connection.db.admin();
    const dbList = await admin.listDatabases();
    console.log('📊 Available databases:', dbList.databases.map(db => `${db.name} (${db.sizeOnDisk} bytes)`));
    
    // Check current database name
    console.log(`🎯 Currently connected to database: ${mongoose.connection.name}`);
    
    // Check if messages exist in raw collection
    const rawMessages = await mongoose.connection.db.collection('messages').countDocuments();
    console.log(`📋 Raw messages collection count: ${rawMessages}`);
    
    // Check other potential message collections
    const collections = await mongoose.connection.db.listCollections().toArray();
    for (const col of collections.filter(c => c.name.includes('message'))) {
      const count = await mongoose.connection.db.collection(col.name).countDocuments();
      console.log(`📁 Collection '${col.name}': ${count} documents`);
    }
    
    // Try to check the default database (test) for messages
    try {
      const testDb = mongoose.connection.client.db('test');
      const testMessages = await testDb.collection('messages').countDocuments();
      console.log(`🧪 Messages in 'test' database: ${testMessages}`);
    } catch (e) {
      console.log('⚠️ Could not check test database');
    }

    console.log(`\n MOngoDB connected !! DB HOST: ${connectionInstance.connection.host}`);
    // console.log("ConnectionInstance :", connectionInstance.connection);

  } catch (error) {
    console.log("Database connectivity error:", error);
    process.exit(1);
  }
};

export default connectDB;
