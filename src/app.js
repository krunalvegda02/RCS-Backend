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

// High-performance middleware for large payloads
app.use(express.json({
  limit: '100mb', // Consistent with urlencoded
  parameterLimit: 100000, // Reduced for performance
  extended: true
}));
app.use(express.urlencoded({
  limit: '100mb', // Consistent with json
  extended: true,
  parameterLimit: 100000 // Reduced for performance
}));

// Optimize timeout for different endpoints
app.use((req, res, next) => {
  if (req.path.includes('/campaigns') || req.path.includes('/check-capability')) {
    req.setTimeout(300000); // 5 minutes instead of 10
    res.setTimeout(300000);
  } else if (req.path.includes('/webhooks')) {
    req.setTimeout(5000); // 5 seconds for webhooks
    res.setTimeout(5000);
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
import { webhookBuffer } from "./services/webhookBuffer.service.js";
// import { handleRazorpayWebhook } from "./controller/razorpay.webhook.controller.js";

app.use("/api/v1", router);
app.use("/api", router);
app.use("/api/realtime", authenticateToken, realtimeRoutes);







// Webhook counter and rate limiting with overflow monitoring
let webhookCount = 0;
let lastLogTime = Date.now();
const LOG_INTERVAL = 5000; // Log every 5 seconds for high-volume monitoring

// Jio RCS Webhook Endpoint - Ultra lightweight with buffering
app.post('/api/v1/jio/rcs/webhooks', (req, res) => {


  // Immediate response to prevent carrier timeouts
  res.status(200).json({ success: true });

  webhookCount++;
  const now = Date.now();
  
  // High-frequency logging for 1 lakh webhook monitoring
  if (now - lastLogTime > LOG_INTERVAL) {
    const bufferStatus = webhookBuffer.getStatus();
    const rate = Math.round(webhookCount / ((now - (lastLogTime - LOG_INTERVAL)) / 1000));
    
    console.log(`📤 Rate: ${rate}/sec | Total: ${webhookCount} | Buffer: ${bufferStatus.buffered}/${bufferStatus.maxSize} | Overflow: ${bufferStatus.overflow} | Dropped: ${bufferStatus.dropped}`);
    
    // Alert if buffer is getting full
    if (bufferStatus.buffered > bufferStatus.maxSize * 0.8) {
      console.warn(`🚨 BUFFER WARNING: ${Math.round((bufferStatus.buffered / bufferStatus.maxSize) * 100)}% full`);
    }
    
    lastLogTime = now;
  }

  const entityType = req.body?.entityType || req.body?.entity?.eventType || 'unknown';

  let messageId = 'no-id';
  if (entityType === 'USER_MESSAGE' && req.body.metaData && req.body.metaData.orgMsgId) {
    messageId = req.body.metaData.orgMsgId;
  } else if (req.body.entity && req.body.entity.messageId) {
    messageId = req.body.entity.messageId;
  }

  const kafkaPayload = {
    data: req.body,
    timestamp: Date.now(),
    messageId
  };

  // Add to buffer instead of direct Kafka send (non-blocking)
  webhookBuffer.add(kafkaPayload);
});










// Razorpay Webhook Endpoint
// app.post('/api/v1/razorpay/webhook', handleRazorpayWebhook); 



export default app;
