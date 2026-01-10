import MessageLog from '../models/messageLog.model.js';
import { sendStatsToKafka } from './kafka.service.js';

class MessageLogProcessor {
  constructor() {
    this.isProcessing = false;
    this.batchSize = 10000; // Increased for faster processing
  }

  async start(intervalMs = 2000) {
    console.log(`[LogProcessor] Starting with ${intervalMs}ms interval, batch size: ${this.batchSize}`);
    
    await this.sendUnprocessedToKafka();
    
    setInterval(async () => {
      if (!this.isProcessing) {
        await this.sendUnprocessedToKafka();
      }
    }, intervalMs);
  }

  async sendUnprocessedToKafka() {
    this.isProcessing = true;
    
    try {
      const logs = await MessageLog.find({ processed: false })
        .select('_id')
        .limit(this.batchSize)
        .lean();
      
      if (logs.length === 0) {
        this.isProcessing = false;
        return;
      }
      
      console.log(`[LogProcessor] Sending ${logs.length} unprocessed logs to Kafka...`);
      
      // Send in parallel batches of 1000
      const promises = [];
      for (let i = 0; i < logs.length; i += 1000) {
        const batch = logs.slice(i, i + 1000);
        const batchPromise = Promise.all(
          batch.map(log => sendStatsToKafka({ logId: log._id.toString() }))
        );
        promises.push(batchPromise);
      }
      
      await Promise.all(promises);
      console.log(`[LogProcessor] ✅ Sent ${logs.length} logs to Kafka`);
    } catch (error) {
      console.error('[LogProcessor] Error:', error.message);
    } finally {
      this.isProcessing = false;
    }
  }
}

export default new MessageLogProcessor();
