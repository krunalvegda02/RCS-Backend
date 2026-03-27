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

// High-performance middleware with minimal overhead
app.use(express.json({
  limit: '50mb', // Reduced from 100mb
  parameterLimit: 50000, // Reduced for performance
  extended: true
}));
app.use(express.urlencoded({
  limit: '50mb', // Reduced from 100mb
  extended: true,
  parameterLimit: 50000 // Reduced for performance
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

// Ultra-high performance webhook endpoint with minimal processing
app.post('/api/v1/jio/rcs/webhooks', (req, res) => {
  // IMMEDIATE response - no processing
  res.status(200).end();

  // Minimal data extraction (no JSON parsing overhead)
  const body = req.body;

  const entityType = body?.entityType || body?.entity?.eventType || 'unknown';

  let messageId = 'no-id';
  if (entityType === 'USER_MESSAGE' && body.metaData && body.metaData.orgMsgId) {
    messageId = body.metaData.orgMsgId;
  } else if (body.entity && body.entity.messageId) {
    messageId = body.entity.messageId;
  }
  
  // Direct buffer add (fastest possible)
  webhookBuffer.add({
    data: body,
    timestamp: Date.now(),
    messageId
  });
  
  // Async logging (non-blocking)
  setImmediate(() => {
    webhookCount++;
    const now = Date.now();
    
    if (now - lastLogTime > LOG_INTERVAL) {
      const bufferStatus = webhookBuffer.getStatus();
      const rate = Math.round(webhookCount / ((now - (lastLogTime - LOG_INTERVAL)) / 1000));
      
      console.log(`📤 Rate: ${rate}/sec | Total: ${webhookCount} | Buffer: ${bufferStatus.buffered}/${bufferStatus.maxSize} | Overflow: ${bufferStatus.overflow}`);
      
      if (bufferStatus.buffered > bufferStatus.maxSize * 0.8) {
        console.warn(`🚨 BUFFER WARNING: ${Math.round((bufferStatus.buffered / bufferStatus.maxSize) * 100)}% full`);
      }
      
      lastLogTime = now;
    }
  });
});










// Razorpay Webhook Endpoint
// app.post('/api/v1/razorpay/webhook', handleRazorpayWebhook); 



export default app;