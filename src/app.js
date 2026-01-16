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
  limit: '1gb',
  parameterLimit: 130000,
  extended: true
}));
app.use(express.urlencoded({
  limit: '1gb',
  extended: true,
  parameterLimit: 130000
}));
// Increase timeout for large requests
app.use((req, res, next) => {
  if (req.path.includes('/campaigns') || req.path.includes('/check-capability')) {
    req.setTimeout(300000); // 5 minutes
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

// Webhook counter
let webhookCount = 0;

// Jio RCS Webhook Endpoint - Ultra lightweight
app.post('/api/v1/jio/rcs/webhooks', (req, res) => {
  res.status(200).json({ success: true });

  webhookCount++;
  const entityType = req.body?.entityType || req.body?.entity?.eventType || 'unknown';
  
  // For USER_MESSAGE: use orgMsgId (original message ID)
  // For STATUS_EVENT: use entity.messageId (the message being tracked)
  const messageId = entityType === 'USER_MESSAGE' 
    ? req.body?.metaData?.orgMsgId || 'no-id'
    : req.body?.entity?.messageId || req.body?.messageId || 'no-id';

  console.log(`\n========== WEBHOOK #${webhookCount} ==========`);
  console.log('Entity Type:', entityType);
  console.log('Message ID:', messageId);
  console.log('Complete Webhook Data:', JSON.stringify(req.body, null, 2));
  console.log('==========================================\n');

  sendWebhookToKafka({
    data: req.body,
    timestamp: Date.now(),
    messageId
  });
});




export default app;
