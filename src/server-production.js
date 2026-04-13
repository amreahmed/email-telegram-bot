require("dotenv").config();

const app = require("./app");
const { connectDB } = require("./config/db");
const { initTelegramBot } = require("./services/telegramService");
const { registerTelegramCommands } = require("./controllers/telegramController");
const { startPolling, stopPolling } = require("./services/pollingService");
const logger = require("./utils/logger");

const port = Number(process.env.PORT || 3000);
const REQUEST_TIMEOUT = 30000;

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection", { reason: String(reason) });
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception", { error: error.message, stack: error.stack });
  process.exit(1);
});

async function bootstrap() {
  try {
    logger.info("Starting application bootstrap...");

    logger.info("Connecting to MongoDB...");
    await connectDB();
    logger.info("MongoDB connected successfully");
  } catch (error) {
    logger.error("Failed to connect to MongoDB", { error: error.message });
    process.exit(1);
  }

  let bot;
  try {
    logger.info("Initializing Telegram bot...");
    bot = initTelegramBot(process.env.BOT_TOKEN);
    logger.info("Bot initialized");

    logger.info("Registering Telegram commands...");
    registerTelegramCommands(bot);
    logger.info("Commands registered");

    logger.info("Launching Telegram bot...");
    await bot.launch();
    logger.info("Telegram bot launched successfully");
  } catch (error) {
    logger.error("Failed to initialize Telegram bot", { error: error.message, stack: error.stack });
    process.exit(1);
  }

  try {
    logger.info("Starting polling service...");
    startPolling();
    logger.info("Polling service started");
  } catch (error) {
    logger.error("Failed to start polling", { error: error.message });
    logger.warn("Continuing without polling...");
  }

  try {
    logger.info("Starting Express server on port", { port });
    const server = app.listen(port, () => {
      logger.info(`Express server listening on port ${port}`);
      logger.info("✅ Application ready for production");
    });

    server.setTimeout(REQUEST_TIMEOUT);

    const shutdown = async (signal) => {
      logger.warn(`Received ${signal}, initiating graceful shutdown...`);

      stopPolling();
      logger.info("Polling stopped");

      try {
        await bot.stop(signal);
        logger.info("Bot stopped");
      } catch (err) {
        logger.error("Error stopping bot", { error: err.message });
      }

      server.close(() => {
        logger.info("Server closed gracefully");
        process.exit(0);
      });

      setTimeout(() => {
        logger.error("Forced shutdown after timeout");
        process.exit(1);
      }, 10000);
    };

    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
  } catch (error) {
    logger.error("Failed to start Express server", { error: error.message });
    process.exit(1);
  }
}

bootstrap().catch((error) => {
  logger.error("Fatal bootstrap error", { error: error.message, stack: error.stack });
  process.exit(1);
});
