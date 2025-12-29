import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import jioRCSService from "./services/JioRCS.service.js";

const app = express();

// Initialize Jio RCS Service
const rcsService = jioRCSService;
console.log('Jio RCS Service initialized');

app.use(
  cors()
);

app.use(express.json({ limit: '50mb' }));
app.use(express.static("public"));
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

//Routes declaration
app.use("/api/v1", router);

export default app;
