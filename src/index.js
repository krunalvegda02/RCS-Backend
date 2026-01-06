import dotenv from "dotenv";
import { createServer } from "http";
import { createServer as createNetServer } from "net";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import connectDB from "./db/index.js";
import app from "./app.js";
import JioRCSService from "./services/JioRCS.service.js";
import { scheduleArchivedCampaignCleanup } from "./schedulers/campaign.scheduler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({
  path: join(__dirname, '../.env'),
});

const port = process.env.PORT || 8000;
if (!process.env.PORT) {
  console.log('⚠️  PORT not set in environment, using default 8000');
}

// Function to find available port
const findAvailablePort = async (startPort) => {
  for (let port = startPort; port <= startPort + 10; port++) {
    const isAvailable = await checkPort(port);
    if (isAvailable) {
      return port;
    }
  }
  throw new Error(`No available ports found starting from ${startPort}`);
};
const checkPort = (port) => {
  return new Promise((resolve) => {
    const server = createNetServer();
    server.listen(port, () => {
      server.once('close', () => resolve(true));
      server.close();
    });
    server.on('error', () => resolve(false));
  });
};

connectDB()
  .then(async () => {
    // Check if configured port is available
    let finalPort = port;
    const isPortAvailable = await checkPort(port);
    
    if (!isPortAvailable) {
      console.warn(`⚠️  Port ${port} is already in use`);
      console.log('🔍 Searching for available port...');
      
      try {
        finalPort = await findAvailablePort(port);
        console.log(`✅ Found available port: ${finalPort}`);
      } catch (error) {
        console.error(`❌ ${error.message}`);
        console.log('💡 Try one of these solutions:');
        console.log(`   1. Kill process using port ${port}: lsof -ti:${port} | xargs kill -9`);
        console.log(`   2. Use different port: PORT=8001 npm start`);
        console.log(`   3. Check if another instance is running`);
        process.exit(1);
      }
    }

    const server = createServer(app);
    
    // Initialize schedulers
    scheduleArchivedCampaignCleanup();
    
    server.listen(finalPort, () => {
      console.log(`🚀 Server is running on port ${finalPort}`);
      
      if (finalPort !== port) {
        console.log(`📝 Note: Using port ${finalPort} instead of ${port}`);
      }
    });

    // Handle port conflicts
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${finalPort} is already in use`);
        console.log('💡 Try one of these solutions:');
        console.log(`   1. Kill process using port ${finalPort}: lsof -ti:${finalPort} | xargs kill -9`);
        console.log(`   2. Use different port: PORT=8001 npm start`);
        console.log(`   3. Check if another instance is running`);
        process.exit(1);
      } else {
        console.error('Server error:', err);
        process.exit(1);
      }
    });

    // Graceful shutdown
    const gracefulShutdown = async () => {
      console.log('Shutting down gracefully...');
      await JioRCSService.cleanup();
      server.close(() => {
        console.log('Process terminated');
        process.exit(0);
      });
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
  })
  .catch((err) => {
    console.log("MONGODB connection failed: ", err);
  });