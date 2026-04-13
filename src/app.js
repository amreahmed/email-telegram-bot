const express = require("express");
const authRoutes = require("./routes/authRoutes");
const logger = require("./utils/logger");

const app = express();

app.use(express.json({ limit: "1mb" }));

app.use((req, res, next) => {
  logger.info("Incoming request", { method: req.method, path: req.path });
  next();
});

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true, time: new Date().toISOString() });
});

app.use("/auth", authRoutes);

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((error, req, res, next) => {
  logger.error("Unhandled request error", {
    path: req.path,
    method: req.method,
    error: error.message,
  });

  res.status(500).json({
    error: "Internal server error",
  });
});

module.exports = app;
