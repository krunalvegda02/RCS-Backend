import dotenv from "dotenv";
import connectDB from "./db/index.js";
import app from "./app.js";
import JioRCSService from "./services/JioRCS.service.js";

dotenv.config({
  path: "./.env",
});

const port = process.env.PORT || 8000;

connectDB()
  .then(() => {
    const server = app.listen(port, () => {
      console.log(`Server is running on port ${port}`);
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