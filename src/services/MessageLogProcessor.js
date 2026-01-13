import MessageLog from '../models/messageLog.model.js';
import { sendStatsToKafka } from './kafka.service.js';

class MessageLogProcessor {
  constructor() {
    this.batchSize = 10000;
    this.lastId = null; // 🔥 BUG FIX #3: Persistent cursor
  }

  async start(intervalMs = 2000) {
    console.log(`[LogProcessor] Starting with ${intervalMs}ms interval, batch size: ${this.batchSize}`);
    
    const loop = async () => {
      await this.sendUnprocessedToKafka();
      setTimeout(loop, intervalMs);
    };
    loop();
  }

  async sendUnprocessedToKafka() {
    try {
      // 🔥 BUG FIX #3: Use persistent lastId cursor
      const query = { processed: false };
      if (this.lastId) {
        query._id = { $gt: this.lastId };
      }
      
      const logs = await MessageLog.find(query)
        .select('_id')
        .sort({ _id: 1 })
        .limit(this.batchSize)
        .lean();
      
      if (logs.length === 0) {
        this.lastId = null; // Reset cursor when no more logs
        return;
      }
      
      this.lastId = logs[logs.length - 1]._id; // Update persistent cursor
      
      console.log(`[LogProcessor] Sending ${logs.length} unprocessed logs to Kafka...`);
      
      const messages = logs.map(log => ({
        key: log._id.toString(),
        value: JSON.stringify({ logId: log._id.toString() })
      }));
      
      for (let i = 0; i < messages.length; i += 1000) {
        const batch = messages.slice(i, i + 1000);
        await sendStatsToKafka(batch, true);
      }
      
      console.log(`[LogProcessor] ✅ Sent ${logs.length} logs to Kafka`);
    } catch (error) {
      console.error('[LogProcessor] Error:', error.message);
    }
  }
}

export default new MessageLogProcessor();
