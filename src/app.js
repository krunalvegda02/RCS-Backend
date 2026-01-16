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
  limit: '100mb',
  parameterLimit: 500000,
  extended: true
}));
app.use(express.urlencoded({
  limit: '100mb',
  extended: true,
  parameterLimit: 500000
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

app.use("/api/v1", router);
app.use("/api/realtime", authenticateToken, realtimeRoutes);

// Webhook counter
let webhookCount = 0;

// Jio RCS Webhook Endpoint - Ultra lightweight
app.post('/api/v1/jio/rcs/webhooks', (req, res) => {
  res.status(200).json({ success: true });

  webhookCount++;
  const entityType = req.body?.entityType || req.body?.entity?.eventType || 'unknown';
  
  // Determine message ID based on webhook type:
  // USER_MESSAGE: use orgMsgId (original message user is responding to)
  // STATUS_EVENT & USER_EVENT: use entity.messageId (message being tracked)
  let messageId = 'no-id';
  if (entityType === 'USER_MESSAGE' && req.body.metaData && req.body.metaData.orgMsgId) {
    messageId = req.body.metaData.orgMsgId;
  } else if (req.body.entity && req.body.entity.messageId) {
    messageId = req.body.entity.messageId;
  }

  console.log(`\n========== WEBHOOK #${webhookCount} ==========`);
  console.log('Entity Type:', entityType);
  console.log('Message ID:', messageId);
  console.log('Complete Webhook Data:', JSON.stringify(req.body, null, 2));
  console.log('==========================================\n');

  const kafkaPayload = {
    data: req.body,
    timestamp: Date.now(),
    messageId
  };
  
  console.log('📤 Sending to Kafka with messageId:', messageId);
  sendWebhookToKafka(kafkaPayload);
});




export default app;
