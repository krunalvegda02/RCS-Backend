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
      origin: process.env.CORS_ORIGIN,
      credentials: true,
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
import { webhookReceiver } from "./controller/webhook.controller.js";
import { authenticateToken } from "./middlewares/auth.middleware.js";

app.use("/api/v1", router);
app.use("/api/realtime", authenticateToken, realtimeRoutes);

app.post('/api/v1/jio/rcs/webhooks', (req, res) => {  
  res.status(200).json({
    success: true,
    message: 'Webhook received',
    timestamp: new Date().toISOString()
  });
  
  // Process webhook using the actual webhook receiver
  setImmediate(async () => {
    try {
      console.log('Processing webhook data...');
      const mockRes = {
        headersSent: true,
        status: () => mockRes,
        json: () => mockRes
      };
      await webhookReceiver(req.body, mockRes);
    } catch (error) {
      console.error('Webhook processing error:', error);
    }
  });
});




export default app;
