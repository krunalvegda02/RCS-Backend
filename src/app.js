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
import Bull from 'bull';
import { authenticateToken } from "./middlewares/auth.middleware.js";

// ONLY queue creation - NO processing in API
const webhookQueue = new Bull('webhook-processing', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379
  }
});

app.use("/api/v1", router);
app.use("/api/realtime", authenticateToken, realtimeRoutes);

app.post('/api/v1/jio/rcs/webhooks', async (req, res) => {  
  const requestId = Math.random().toString(36).substr(2, 9);
  // const requestId = "1234";
  
  // Log incoming webhook
  console.log(`🔔 [${requestId}] Webhook received:`, JSON.stringify(req.body, null, 2));
  
  try {
    const entityType = req.body?.entityType;
    const priority = entityType === "USER_MESSAGE" ? 5 : 10;
    
    await webhookQueue.add('webhook-data', {
      data: req.body,
      timestamp: Date.now(),
      requestId
    }, { priority });
    
    // Single response only
    res.status(200).json({
      success: true,
      requestId
    });
    
    console.log(`✅ [${requestId}] Queued: ${entityType}`);
  } catch (error) {
    console.error(`❌ [${requestId}] Queue error:`, error.message);
    res.status(200).json({ success: true }); // Never fail webhooks
  }
});




export default app;
