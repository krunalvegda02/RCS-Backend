import connectDB from '../db/index.js';
import MessageLogProcessor from '../services/MessageLogProcessor.js';

process.env.WORKER_MODE = 'true';

async function startLogProcessor() {
  try {
    await connectDB();
    console.log('✅ Log Processor connected to MongoDB');
    
    // Start with 2 second interval for faster processing
    await MessageLogProcessor.start(2000);
    
    const shutdown = async () => {
      console.log('🛑 Shutting down log processor...');
      process.exit(0);
    };
    
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    
  } catch (error) {
    console.error('❌ Log processor startup failed:', error);
    process.exit(1);
  }
}

startLogProcessor();
