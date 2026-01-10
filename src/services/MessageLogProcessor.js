import MessageLog from '../models/messageLog.model.js';
import ContactCampaignMessage from '../models/message.model.js';
import User from '../models/user.model.js';
import Campaign from '../models/campaign.model.js';
import { sendStatsToKafka } from './kafka.service.js';

class MessageLogProcessor {
  constructor() {
    this.isProcessing = false;
    this.batchSize = 5000;
  }

  async start(intervalMs = 5000) {
    console.log(`[LogProcessor] Starting Kafka-based processor with ${intervalMs}ms interval`);
    
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
      
      for (const log of logs) {
        sendStatsToKafka({ logId: log._id.toString() });
      }
      
      console.log(`[LogProcessor] ✅ Sent ${logs.length} logs to Kafka for processing`);
    } catch (error) {
      console.error('[LogProcessor] Error:', error.message);
    } finally {
      this.isProcessing = false;
    }
  }
}

export default new MessageLogProcessor();
