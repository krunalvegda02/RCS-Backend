import cron from 'node-cron';
import mongoose from 'mongoose';

const BATCH_SIZE = 10000;
const DELAY_BETWEEN_BATCHES = 2000;

async function deleteProcessedLogs() {
  try {
    console.log('\n========== DELETE PROCESSED LOGS START ==========');
    console.log('Time:', new Date().toISOString());
    
    const MessageLog = mongoose.model('MessageLog');
    
    const totalProcessed = await MessageLog.countDocuments({ processed: true });
    console.log(`Total processed logs to delete: ${totalProcessed.toLocaleString()}`);
    
    if (totalProcessed === 0) {
      console.log('No processed logs to delete');
      return;
    }
    
    let deletedCount = 0;
    let batchNumber = 0;
    
    while (true) {
      batchNumber++;
      
      const logsToDelete = await MessageLog.find({ processed: true })
        .select('_id')
        .limit(BATCH_SIZE)
        .lean();
      
      if (logsToDelete.length === 0) {
        break;
      }
      
      const logIds = logsToDelete.map(log => log._id);
      const result = await MessageLog.deleteMany({ _id: { $in: logIds } });
      deletedCount += result.deletedCount;
      
      console.log(`Batch ${batchNumber}: Deleted ${result.deletedCount.toLocaleString()} logs (Total: ${deletedCount.toLocaleString()}/${totalProcessed.toLocaleString()})`);
      
      if (logsToDelete.length < BATCH_SIZE) {
        break;
      }
      
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
    }
    
    console.log(`\n✅ Successfully deleted ${deletedCount.toLocaleString()} processed logs`);
    console.log('========== DELETE PROCESSED LOGS END ==========\n');
    
  } catch (error) {
    console.error('❌ Error deleting processed logs:', error);
  }
}

export default function initCronJobs() {
  console.log('🕐 Initializing Cron Jobs...');
  
  // Delete processed logs every day at midnight IST
  cron.schedule('0 0 * * *', async () => {
    console.log('\n🔄 Starting scheduled cleanup of processed message logs...');
    try {
      await deleteProcessedLogs();
      console.log('✅ Scheduled cleanup completed successfully');
    } catch (error) {
      console.error('❌ Scheduled cleanup failed:', error);
    }
  }, {
    timezone: 'Asia/Kolkata'
  });
  
  console.log('✅ Cron Job: Delete processed logs - Scheduled at 00:00 IST daily');
}
