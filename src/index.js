import dotenv from "dotenv";
import cluster from "cluster";
import os from "os";
import { createServer } from "http";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import app from "./app.js";
import connectDB from "./db/index.js";


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({
  path: join(__dirname, "../.env"),
});

const PORT = process.env.PORT || 3000;
const numCPUs = os.cpus().length;

/* ============================
   PRIMARY PROCESS
============================ */
if (cluster.isPrimary) {
  console.log(`🧠 Primary ${process.pid} running`);
  console.log(`⚙️ Forking ${numCPUs} workers...\n`);

  // Connect DB in primary process for cron jobs
  await connectDB();

  // Start cron jobs only in primary process
  const { startPaymentExpirationCron } = await import('./services/paymentExpiration.service.js');
  startPaymentExpirationCron();

  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on("exit", (worker, code, signal) => {
    console.error(`❌ Worker ${worker.process.pid} died`);
    console.log("♻️ Restarting worker...");
    cluster.fork();
  });

  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));

  /* ============================
     WORKER PROCESS
  ============================ */
} else {
  (async () => {
    try {
      console.log(`🚀 Worker ${process.pid} starting`);

      // DB connection per worker
      await connectDB();

      const server = createServer(app);

      // Increase server timeout for large requests
      server.timeout = 600000; // 10 minutes
      server.keepAliveTimeout = 610000; // 10 minutes + 10 seconds
      server.headersTimeout = 620000; // 10 minutes + 20 seconds

      server.listen(PORT, () => {
        console.log(`✅ Worker ${process.pid} listening on port ${PORT}`);
      });

      /* -------- GRACEFUL SHUTDOWN -------- */
      const gracefulShutdown = async () => {
        console.log(`🛑 Worker ${process.pid} shutting down`);
        // await JioRCSService.cleanup();
        server.close(() => process.exit(0));
      };

      process.on("SIGINT", gracefulShutdown);
      process.on("SIGTERM", gracefulShutdown);

    } catch (err) {
      console.error("❌ Worker startup failed:", err);
      process.exit(1);
    }
  })();
}
