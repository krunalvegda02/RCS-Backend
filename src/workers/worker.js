import mongoose from 'mongoose';
import Bull from 'bull';
import '../models/campaign.model.js';
import '../models/message.model.js';
import '../models/messageLog.model.js';
import '../models/template.model.js';
import { processWebhookData, processUserInteraction } from '../controller/webhook.controller.js';
import BackgroundWorkerService from '../services/BackgroundWorkerService.js';
import MessageLogProcessor from '../services/MessageLogProcessor.js';
import connectDB from '../db/index.js';

// Set worker mode
process.env.WORKER_MODE = 'true';

// Initialize ALL queues with processing
const webhookQueue = new Bull('webhook-processing', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: 100,
    removeOnFail: 50
  }
});

const statsQueue = new Bull('background-stats-sync', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379
  },
  defaultJobOptions: {
    removeOnComplete: 5,
    removeOnFail: 10
  }
});

async function startWorker() {
  try {
    await connectDB();
    console.log('✅ Worker connected to MongoDB');
    
    // Test database access
    const ContactCampaignMessage = mongoose.model('ContactCampaignMessage');
    const testCount = await ContactCampaignMessage.countDocuments();
    console.log(`📊 Worker sees ${testCount} contact records in database`);
    
    // Process webhook jobs from API
    webhookQueue.process('webhook-data', 50, async (job) => {
      const { data, timestamp, requestId } = job.data;
      console.log(`\n[Worker] ========================================`);
      console.log(`[Worker] Processing job: ${requestId}`);
      console.log(`[Worker] Job ID: ${job.id}`);
      console.log(`[Worker] Timestamp: ${new Date(timestamp).toISOString()}`);
      console.log(`[Worker] ========================================\n`);
      
      const entityType = data?.entityType;
      
      try {
        if (entityType === "USER_MESSAGE") {
          console.log(`[Worker] Routing to processUserInteraction`);
          await processUserInteraction(data, timestamp);
        } else {
          console.log(`[Worker] Routing to processWebhookData`);
          await processWebhookData(data, timestamp);
        }
        
        console.log(`\n[Worker] ✅ Completed ${requestId}\n`);
      } catch (error) {
        console.error(`\n[Worker] ❌ Failed ${requestId}:`, error.message);
        console.error(`[Worker] Error stack:`, error.stack);
        throw error;
      }
    });

    // Initialize background services with queue processing
    const backgroundWorker = new BackgroundWorkerService(statsQueue);
    console.log('🚀 Background Worker Service started');

    // Start message log processor (optimized for 200K+ messages)
    // Processes 2000 logs every 10 seconds = 720K logs/hour capacity
    MessageLogProcessor.start(10000);
    console.log('🚀 Message Log Processor started (10s interval, 2000 batch size)');

    // Send ready signal to PM2
    if (process.send) {
      process.send('ready');
    }

    // Graceful shutdown
    const shutdown = async () => {
      console.log('🛑 Shutting down worker...');
      await Promise.all([
        webhookQueue.close(),
        statsQueue.close(),
        mongoose.connection.close()
      ]);
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

  } catch (error) {
    console.error('❌ Worker startup failed:', error);
    process.exit(1);
  }
}

startWorker();







































// 🟢 PHASE 2 — Aggregator Worker (NEW, THIS FIXES LOAD)

// Create a separate worker / cron that runs every 30s–60s.

// This worker:

// Reads message_logs

// Groups by messageId

// Determines final status

// Updates messages in BULK

// Updates wallets in BULK

// Updates campaign stats in BULK

// Example aggregation logic (Mongo)
// db.message_logs.aggregate([
//   { $match: { processed: false, eventType: "status_update" } },
//   {
//     $group: {
//       _id: "$messageId",
//       latestEvent: { $last: "$webhookData.eventType" }
//     }
//   },
//   { $limit: 5000 }
// ])


// Then:

// Message.bulkWrite([
//   {
//     updateOne: {
//       filter: { messageId },
//       update: { $set: { status: finalStatus } }
//     }
//   }
// ]);


// ✔ 5,000 messages updated in ONE DB round-trip
// ❌ Not 5,000 individual updates



// 🟢 PHASE 3 — Wallet & Campaign Sync (SEPARATE QUEUE)

// Your wallet logic is very expensive.

// ❌ Current (bad)

// Wallet updates inside webhook worker.

// ✅ Correct

// Push wallet jobs into wallet-settlement queue

// Process in batches:

// group by userId

// net debit / credit

// single user.save()

// Same for campaign stats.

// 🔥 Socket.IO Is ALSO Killing You

// You are doing:

// global.io.to(...).emit("message_status_update", ...)


// ❌ per message

// Replace with:

// Campaign-level summary events

// socket.emit("campaign_update", {
//   campaignId,
//   deliveredDelta: +1200,
//   failedDelta: +45
// });
