import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import jioRCSService from "./services/JioRCS.service.js";
// import { createAdmin } from "./utils/createAdmin.js"; 

const app = express();

// Initialize Jio RCS Service
const rcsService = jioRCSService;
console.log('Jio RCS Service initialized');

// Create admin on startup
// createAdmin(); 

app.use(
  cors(
    {
      origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization']
    }
  )
);

// High-performance middleware for large payloads
app.use(express.json({
  limit: '500mb',
  parameterLimit: 130000,
  extended: true
}));
app.use(express.urlencoded({
  limit: '500mb',
  extended: true,
  parameterLimit: 130000
}));
// Timeout middleware for large campaigns
app.use((req, res, next) => {
  // Increase timeout for campaign creation
  if (req.path.includes('/campaigns') && req.method === 'POST') {
    req.setTimeout(300000); // 5 minutes for large campaigns
    res.setTimeout(300000);
  }
  next();
});
app.use(cookieParser());



// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message,
  });
});


//Routes Import
import router from "./routes/index.js";
import realtimeRoutes from "./routes/realtime.routes.js";
import { authenticateToken } from "./middlewares/auth.middleware.js";
import { sendWebhookToKafka } from "./services/kafka.service.js";

app.use("/api/v1", router);
app.use("/api/realtime", authenticateToken, realtimeRoutes);

// Webhook counter with event type tracking
let webhookCount = 0;
let webhooksByType = {};
let uniqueMessageIds = new Set();
let droppedRequests = 0;
let errorCount = 0;
let startTime = Date.now();
let lastLogTime = Date.now();
console.log('🚀 Webhook counter initialized - tracking all incoming webhooks');

// Track all requests to webhook endpoint
app.use('/api/v1/jio/rcs/webhooks', (req, res, next) => {
  const requestStart = Date.now();
  
  // Track response
  const originalSend = res.send;
  res.send = function(data) {
    const duration = Date.now() - requestStart;
    if (duration > 5000) {
      console.warn(`⚠️ Slow webhook response: ${duration}ms`);
    }
    return originalSend.call(this, data);
  };
  
  // Track if request times out
  req.on('timeout', () => {
    droppedRequests++;
    console.error(`❌ REQUEST TIMEOUT - Total dropped: ${droppedRequests}`);
  });
  
  next();
});

// Jio RCS Webhook Endpoint
app.post('/api/v1/jio/rcs/webhooks', (req, res) => {
  try {
    const messageId = req.body?.entity?.messageId || req.body?.messageId;
    const eventType = req.body?.entity?.eventType || req.body?.eventType;
    
    // Respond immediately (BEFORE processing)
    res.status(200).json({ success: true });
    
    // Increment counters
    webhookCount++;
    webhooksByType[eventType] = (webhooksByType[eventType] || 0) + 1;
    if (messageId) uniqueMessageIds.add(messageId);

    // Log every 100 webhooks OR every 10 seconds
    const now = Date.now();
    if (webhookCount % 100 === 0 || (now - lastLogTime) > 10000) {
      const elapsed = (now - startTime) / 1000;
      const rate = (webhookCount / elapsed).toFixed(2);
      console.log(`📊 WEBHOOK STATS: Total=${webhookCount} | Unique=${uniqueMessageIds.size} | Dropped=${droppedRequests} | Errors=${errorCount} | Rate=${rate}/sec`);
      console.log(`📊 Event Breakdown:`, webhooksByType);
      lastLogTime = now;
    }

    // Send to Kafka async (non-blocking)
    sendWebhookToKafka({
      data: req.body,
      timestamp: Date.now(),
      messageId
    }).catch(err => {
      errorCount++;
      console.error(`[Webhook] ❌ Kafka error for ${messageId}:`, err.message);
    });
  } catch (error) {
    errorCount++;
    console.error(`[Webhook] ❌ Processing error:`, error.message);
  }
});




export default app;
