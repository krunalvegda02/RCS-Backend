import { connectWithRetry, closeConnection, setupGracefulShutdown } from './mongoConnection.js';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

// Setup graceful shutdown
setupGracefulShutdown();

async function testConnection() {
  try {
    console.log('🧪 Testing MongoDB connection and queries...');
    
    await connectWithRetry();
    
    // Test basic query operations
    const testSchema = new mongoose.Schema({
      name: String,
      role: String,
      createdAt: Date
    });
    
    const TestModel = mongoose.model('Test', testSchema);
    
    // Test query with $ne operator
    console.log('🧪 Testing $ne query...');
    const result1 = await TestModel.find({ role: { $ne: 'ADMIN' } }).limit(1);
    console.log('✅ $ne query works');
    
    // Test query with date range
    console.log('🧪 Testing date range query...');
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    const result2 = await TestModel.find({
      createdAt: {
        $gte: yesterday,
        $lte: now
      }
    }).limit(1);
    console.log('✅ Date range query works');
    
    console.log('🎉 All tests passed! MongoDB connection is working correctly.');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Error details:', {
      name: error.name,
      code: error.code,
      path: error.path,
      value: error.value
    });
  } finally {
    await closeConnection();
    console.log('🔌 Connection closed');
    process.exit(0);
  }
}

testConnection();