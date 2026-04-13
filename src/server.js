require("dotenv").config();

const app = require("./app");
const { connectDB } = require("./config/db");
const { initTelegramBot } = require("./services/telegramService");
const { registerTelegramCommands } = require("./controllers/telegramController");
const { startPolling, stopPolling } = require("./services/pollingService");
const logger = require("./utils/logger").withContext("TelegramBot");

const port = Number(process.env.PORT || 3000);

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", {
    error: reason instanceof Error ? reason.message : String(reason),
  });
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", { error: error.message, stack: error.stack });
});

async function bootstrap() {
  try {
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

    logger.info("Launching Telegram bot (background)...");
    // Don't await - let it run in background to avoid hanging
    bot.launch().catch((err) => {
      logger.error("Bot launch error", { error: err.message });
    });
    logger.info("Telegram bot launch initiated");
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
  }

  try {
    logger.info("Starting Express server on port", { port });
    const server = app.listen(port, () => {
      logger.info(`Express server listening on port ${port}`);
    });

    const shutdown = async (signal) => {
      logger.warn(`Received ${signal}, shutting down`);
      stopPolling();
      try {
        await bot.stop(signal);
      } catch (stopError) {
        logger.error("Error stopping bot", { error: stopError.message });
      }
      server.close(() => {
        logger.info("Server closed");
        process.exit(0);
      });
    };

    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
  } catch (error) {
    logger.error("Failed to start Express server", { error: error.message });
    process.exit(1);
  }
}

bootstrap().catch((error) => {
  logger.error("Fatal startup error", { error: error.message });
  process.exit(1);
});
