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

// Raw body parser for Razorpay webhook signature verification
// Must be before other body parsers
// app.use('/api/v1/razorpay/webhook', express.raw({ type: 'application/json' }), (req, res, next) => {
//   if (Buffer.isBuffer(req.body)) {
//     req.rawBody = req.body.toString('utf8');
//     try {
//       req.body = JSON.parse(req.rawBody);
//     } catch (e) {
//       req.body = {};
//     }
//   }
//   next();
// });

// EXTREME performance middleware - webhook optimized
app.use('/api/v1/jio/rcs/webhooks', express.json({
  limit: '10mb',
  strict: false,
  type: 'application/json'
}));

// Standard middleware for other routes
app.use(express.json({
  limit: '50mb',
  parameterLimit: 50000,
  extended: true
}));
app.use(express.urlencoded({
  limit: '50mb',
  extended: true,
  parameterLimit: 50000
}));

// Ultra-fast timeout for webhooks only
app.use((req, res, next) => {
  if (req.path.includes('/webhooks')) {
    req.setTimeout(2000); // Reduced to 2 seconds
    res.setTimeout(2000);
  } else if (req.path.includes('/campaigns') || req.path.includes('/check-capability')) {
    req.setTimeout(300000); // 5 minutes for campaigns
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
import performanceRoutes from "./routes/performance.routes.js";
import { authenticateToken } from "./middlewares/auth.middleware.js";
import { sendWebhookToKafka } from "./services/kafka.service.js";
import { webhookBuffer } from "./services/webhookBuffer.service.js";
// import { handleRazorpayWebhook } from "./controller/razorpay.webhook.controller.js";

app.use("/api/v1", router);
app.use("/api", router);
app.use("/api/realtime", authenticateToken, realtimeRoutes);
app.use("/api/performance", performanceRoutes); // Public performance monitoring







// Webhook counter and rate limiting with overflow monitoring
let webhookCount = 0;
let lastLogTime = Date.now();
const LOG_INTERVAL = 5000; // Log every 5 seconds for high-volume monitoring

// EXTREME performance webhook endpoint - zero blocking operations
app.post('/api/v1/jio/rcs/webhooks', (req, res) => {
  // INSTANT response with keep-alive
  res.writeHead(200, { 'Connection': 'keep-alive' });
  res.end();

  // Ultra-minimal extraction - no optional chaining
  const body = req.body;
  const entity = body.entity;
  const metaData = body.metaData;
  
  const entityType = body.entityType || (entity && entity.eventType) || 'unknown';
  let messageId = 'no-id';
  
  if (entityType === 'USER_MESSAGE' && metaData && metaData.orgMsgId) {
    messageId = metaData.orgMsgId;
  } else if (entity && entity.messageId) {
    messageId = entity.messageId;
  }
  
  // Direct buffer add (fastest possible)
  webhookBuffer.add({
    data: body,
    timestamp: Date.now(),
    messageId
  });
  
  // Micro-batched logging (every 1000 requests)
  if (++webhookCount % 1000 === 0) {
    process.nextTick(() => {
      const now = Date.now();
      const rate = Math.round(1000 / ((now - lastLogTime) / 1000));
      const status = webhookBuffer.getStatus();
      
      console.log(`📤 ${rate}/sec | ${webhookCount} total | Buffer: ${status.buffered}`);
      lastLogTime = now;
    });
  }
});










// Razorpay Webhook Endpoint
// app.post('/api/v1/razorpay/webhook', handleRazorpayWebhook); 



export default app;
