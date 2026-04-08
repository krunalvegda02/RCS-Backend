import mongoose from 'mongoose';
import { connectDB, gracefulShutdown } from './mongoConnection.js';

const BATCH_SIZE = 10000; // Delete 10k logs at a time
const DELAY_BETWEEN_BATCHES = 2000; // 2 seconds delay between batches

async function deleteProcessedLogs() {
  try {
    console.log('\n========== DELETE PROCESSED LOGS START ==========');
    console.log('Time:', new Date().toISOString());
    
    await connectDB();
    
    const MessageLog = mongoose.model('MessageLog');
    
    // Count total processed logs to delete
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
      
      // Find IDs of processed logs (limit to batch size)
      const logsToDelete = await MessageLog.find({ processed: true })
        .select('_id')
        .limit(BATCH_SIZE)
        .lean();
      
      if (logsToDelete.length === 0) {
        console.log('No more logs to delete');
        break;
      }
      
      const logIds = logsToDelete.map(log => log._id);
      
      // Delete batch
      const result = await MessageLog.deleteMany({ _id: { $in: logIds } });
      deletedCount += result.deletedCount;
      
      console.log(`Batch ${batchNumber}: Deleted ${result.deletedCount.toLocaleString()} logs (Total: ${deletedCount.toLocaleString()}/${totalProcessed.toLocaleString()})`);
      
      // If we deleted less than batch size, we're done
      if (logsToDelete.length < BATCH_SIZE) {
        break;
      }
      
      // Wait before next batch to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
    }
    
    console.log(`\n✅ Successfully deleted ${deletedCount.toLocaleString()} processed logs`);
    console.log('========== DELETE PROCESSED LOGS END ==========\n');
    
  } catch (error) {
    console.error('❌ Error deleting processed logs:', error);
    throw error;
  } finally {
    await gracefulShutdown();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  deleteProcessedLogs()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export default deleteProcessedLogs;
