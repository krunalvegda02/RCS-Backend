import mongoose from 'mongoose';
import { Kafka } from 'kafkajs';
import connectDB from '../db/index.js';

process.env.WORKER_MODE = 'true';

const BATCH_SIZE = 500;
const FLUSH_INTERVAL = 200;

async function startDBWriter() {
  try {
    await connectDB();
    console.log('✅ DB Writer connected to MongoDB');
    
    const kafka = new Kafka({
      clientId: 'db-writer',
      brokers: [process.env.KAFKA_BROKER || 'localhost:9092']
    });
    
    const consumer = kafka.consumer({ 
      groupId: 'db-writers',
      sessionTimeout: 30000,
      heartbeatInterval: 3000
    });
    
    await consumer.connect();
    await consumer.subscribe({ topic: 'rcs-db-updates', fromBeginning: false });
    
    console.log('✅ DB Writer subscribed to rcs-db-updates');
    
    let bulkOps = [];
    let lastFlush = Date.now();
    let totalWrites = 0;
    
    await consumer.run({
      partitionsConsumedConcurrently: 3,
      eachBatchAutoResolve: false,
      eachBatch: async ({ batch, resolveOffset, heartbeat }) => {
        for (const message of batch.messages) {
          const update = JSON.parse(message.value.toString());
          
          bulkOps.push({
            updateOne: {
              filter: { 
                'campaigns.messageId': update.messageId,
                'campaigns.campaignId': update.campaignId
              },
              update: { $set: update.fields }
            }
          });
          
          await resolveOffset(message.offset);
          
          // Flush if batch full or time elapsed
          if (bulkOps.length >= BATCH_SIZE || Date.now() - lastFlush >= FLUSH_INTERVAL) {
            if (bulkOps.length > 0) {
              try {
                await ContactCampaignMessage.bulkWrite(bulkOps, { ordered: false });
                totalWrites += bulkOps.length;
                console.log(`[DBWriter] Flushed ${bulkOps.length} updates | Total: ${totalWrites}`);
              } catch (err) {
                console.error('[DBWriter] Bulk write error:', err.message);
              }
              bulkOps = [];
              lastFlush = Date.now();
            }
          }
          
          await heartbeat();
        }
      }
    });
    
  } catch (error) {
    console.error('❌ DB Writer startup failed:', error);
    process.exit(1);
  }
}

startDBWriter();
