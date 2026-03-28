import mongoose from 'mongoose';

async function checkUnprocessedMessages() {
  try {
    await mongoose.connect('mongodb+srv://sikarwarvishal75_db_user:Gama%40123@cluster0.whqwih.mongodb.net/rcs?retryWrites=true&w=majority');
    
    const MessageLog = (await import('./src/models/messageLog.model.js')).default;
    
    // Sample messageIds from the logs
    const sampleMessageIds = [
      '69c7b3c54b49fdeca5067eb9-52-872-1774695366850-uyf7ckzpw',
      '69c7b3c54b49fdeca5067eb9-47-983-1774695366835-m0ff1niy5',
      '69c7b3c54b49fdeca5067eb9-6-163-1774695673437-yhgdlbeqt',
      '69c7b3c54b49fdeca5067eb9-91-908-1774695366906-ojixmmqet',
      '69c7b3c54b49fdeca5067eb9-80-526-1774695616214-jfrgvbp4j'
    ];
    
    console.log('🔍 Checking why these messageIds are still unprocessed...\n');
    
    for (const messageId of sampleMessageIds) {
      console.log(`📧 MessageId: ${messageId}`);
      
      // Find all MessageLog entries for this messageId
      const logs = await MessageLog.find({ messageId }).lean();
      
      if (logs.length === 0) {
        console.log('  ❌ No MessageLog entries found');
        continue;
      }
      
      console.log(`  📝 Found ${logs.length} MessageLog entries:`);
      
      logs.forEach((log, index) => {
        console.log(`    Entry ${index + 1}:`);
        console.log(`      ID: ${log._id}`);
        console.log(`      Processed: ${log.processed}`);
        console.log(`      Event: ${log.webhookData?.eventType || 'unknown'}`);
        console.log(`      Created: ${log.createdAt || 'unknown'}`);
        console.log(`      ProcessedAt: ${log.processedAt || 'not processed'}`);
        console.log(`      ProcessingLock: ${log.processingLock || 'none'}`);
      });
      
      // Count processed vs unprocessed
      const processedCount = logs.filter(l => l.processed).length;
      const unprocessedCount = logs.filter(l => !l.processed).length;
      
      console.log(`  📊 Summary: ${processedCount} processed, ${unprocessedCount} unprocessed`);
      
      if (unprocessedCount > 0) {
        console.log(`  ⚠️ Still has ${unprocessedCount} unprocessed entries`);
      } else {
        console.log(`  ✅ All entries are processed`);
      }
      
      console.log(''); // Empty line for readability
    }
    
    // Check total unprocessed count
    const totalUnprocessed = await MessageLog.countDocuments({ processed: false });
    console.log(`\n📊 Total unprocessed logs in database: ${totalUnprocessed}`);
    
    // Check if there are any processing locks
    const lockedCount = await MessageLog.countDocuments({ 
      processed: false, 
      processingLock: { $exists: true } 
    });
    console.log(`🔒 Logs with processing locks: ${lockedCount}`);
    
    // Check recent unprocessed logs
    const recentUnprocessed = await MessageLog.find({ processed: false })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();
      
    console.log(`\n🕒 Most recent unprocessed logs:`);
    recentUnprocessed.forEach((log, index) => {
      console.log(`  ${index + 1}. ${log.messageId} - ${log.webhookData?.eventType} - ${log.createdAt || 'no date'}`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkUnprocessedMessages();