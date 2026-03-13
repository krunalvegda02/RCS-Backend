import mongoose from 'mongoose';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const testConnection = async () => {
  try {
    console.log('🔍 Testing MongoDB Connection...');
    console.log('📍 Environment:', process.env.NODE_ENV || 'development');
    console.log('📍 MONGODB_URI:', process.env.MONGODB_URI ? 'SET' : 'NOT SET');
    
    if (!process.env.MONGODB_URI) {
      console.error('❌ MONGODB_URI environment variable is not set');
      process.exit(1);
    }

    // Show partial connection string for verification (hide password)
    const uri = process.env.MONGODB_URI;
    const maskedUri = uri.replace(/:([^@]+)@/, ':****@');
    console.log('📍 Connection String:', maskedUri);

    // Test connection
    console.log('🔌 Connecting to MongoDB...');
    const connection = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
    });

    console.log('✅ MongoDB Connected Successfully!');
    console.log('📊 Database Name:', connection.connection.name);
    console.log('🏠 Host:', connection.connection.host);
    console.log('🔢 Port:', connection.connection.port);
    console.log('📈 Ready State:', connection.connection.readyState);

    // Test a simple query
    console.log('🧪 Testing database query...');
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log('📁 Collections found:', collections.length);
    console.log('📋 Collection names:', collections.map(c => c.name).join(', '));

    // Test specific collections
    const Campaign = mongoose.model('Campaign', new mongoose.Schema({}, { strict: false }));
    const campaignCount = await Campaign.countDocuments();
    console.log('📊 Total campaigns:', campaignCount);

    console.log('✅ All tests passed! Database is working correctly.');
    
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    
    if (error.message.includes('authentication failed')) {
      console.error('🔐 Authentication issue - check username/password');
    } else if (error.message.includes('ENOTFOUND')) {
      console.error('🌐 DNS resolution failed - check cluster URL');
    } else if (error.message.includes('timeout')) {
      console.error('⏰ Connection timeout - check network/firewall');
    }
    
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
    process.exit(0);
  }
};

testConnection();