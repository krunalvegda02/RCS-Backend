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

// Jio RCS Webhook Endpoint (fire-and-forget to Kafka)
app.post('/api/v1/jio/rcs/webhooks', (req, res) => {
  // Respond immediately
  console.log("webhook received", req.body.data)
  res.status(200).json({ success: true });

  // Send to Kafka async (don't await)
  sendWebhookToKafka({
    data: req.body,
    timestamp: Date.now(),
    messageId: req.body?.entity?.messageId || req.body?.messageId
  });
});




export default app;
