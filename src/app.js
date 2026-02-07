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
app.use('/api/v1/razorpay/webhook', express.raw({ type: 'application/json' }), (req, res, next) => {
  if (Buffer.isBuffer(req.body)) {
    req.rawBody = req.body.toString('utf8');
    try {
      req.body = JSON.parse(req.rawBody);
    } catch (e) {
      req.body = {};
    }
  }
  next();
});

// High-performance middleware for large payloads
app.use(express.json({
  limit: '10000mb',
  parameterLimit: 5000000,
  extended: true
}));
app.use(express.urlencoded({
  limit: '10000mb',
  extended: true,
  parameterLimit: 5000000
}));
// Increase timeout for large requests
app.use((req, res, next) => {
  if (req.path.includes('/campaigns') || req.path.includes('/check-capability')) {
    req.setTimeout(600000); // 10 minutes
    res.setTimeout(600000);
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
// import { handleRazorpayWebhook } from "./controller/razorpay.webhook.controller.js";

app.use("/api/v1", router);
app.use("/api", router);
app.use("/api/realtime", authenticateToken, realtimeRoutes);





// Webhook counter
let webhookCount = 0;




// Jio RCS Webhook Endpoint - Ultra lightweight
app.post('/api/v1/jio/rcs/webhooks', (req, res) => {
  res.status(200).json({ success: true });

  webhookCount++;
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

  console.log('📤 Sending to Kafka with messageId:', messageId);
  sendWebhookToKafka(kafkaPayload);
});




// Razorpay Webhook Endpoint
// app.post('/api/v1/razorpay/webhook', handleRazorpayWebhook); 



export default app;
