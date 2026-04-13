const { Telegraf } = require("telegraf");
const logger = require("../utils/logger");

let bot;

function initTelegramBot(token) {
  if (!token) {
    throw new Error("BOT_TOKEN is required");
  }

  bot = new Telegraf(token);
  return bot;
}

function getTelegramBot() {
  if (!bot) {
    throw new Error("Telegram bot not initialized");
  }
  return bot;
}

async function safeSendMessage(chatId, message) {
  try {
    await getTelegramBot().telegram.sendMessage(chatId, message, {
      disable_web_page_preview: true,
    });
  } catch (error) {
    logger.error("Failed to send Telegram message", {
      chatId,
      error: error.message,
    });
  }
}

module.exports = {
  initTelegramBot,
  getTelegramBot,
  safeSendMessage,
};
