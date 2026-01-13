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

// Webhook counter
let webhookCount = 0;
let startTime = Date.now();
console.log('🚀 Webhook counter initialized - tracking all incoming webhooks');

// Jio RCS Webhook Endpoint
app.post('/api/v1/jio/rcs/webhooks', async (req, res) => {
  const messageId = req.body?.entity?.messageId || req.body?.messageId;
  const eventType = req.body?.entity?.eventType || req.body?.eventType;
  
  console.log(`[Webhook] Received: ${messageId}, eventType = ${eventType}`);
  
  // Increment counter
  webhookCount++;

  // Log every 100 webhooks for visibility
  if (webhookCount % 100 === 0) {
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = (webhookCount / elapsed).toFixed(2);
    console.log(`📊 WEBHOOK COUNT: ${webhookCount} | Rate: ${rate} / sec | Elapsed: ${elapsed.toFixed(1)}s`);
  }

  // Respond immediately
  res.status(200).json({ success: true });

  // Send to Kafka async
  const result = await sendWebhookToKafka({
    data: req.body,
    timestamp: Date.now(),
    messageId
  });
  
  if (!result.success) {
    console.error(`[Webhook] ❌ Failed to send to Kafka: ${messageId}`);
  }
});




export default app;
