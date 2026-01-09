import dotenv from 'dotenv';
import connectDB from '../src/db/index.js';
import MessageLogProcessor from '../src/services/MessageLogProcessor.js';

dotenv.config();

async function testProcessor() {
  try {
    console.log('🔍 Testing MessageLogProcessor\n');
    
    await connectDB();
    console.log('✅ Connected to database\n');

    console.log('Running one batch manually...\n');
    await MessageLogProcessor.processBatch();
    
    console.log('\n✅ Test complete! Check output above for any errors.');
    console.log('\nIf you see "Processing X webhook logs", the processor works.');
    console.log('If you see "No unprocessed logs", all logs are already processed.');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testProcessor();
