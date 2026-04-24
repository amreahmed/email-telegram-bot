const path = require("path");

const { Telegraf } = require("telegraf");
const logger = require("../utils/logger").withContext("TelegramService");

let bot;
const TELEGRAM_MESSAGE_LIMIT = 3900;
const TELEGRAM_CAPTION_LIMIT = 900;

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

function normalizeTelegramId(value) {
  return String(value ?? "").trim();
}

function getAuditChatIds() {
  return String(process.env.BOT_AUDIT_CHAT_IDS || "")
    .split(",")
    .map((item) => normalizeTelegramId(item))
    .filter(Boolean);
}

function isAuditChat(chatId) {
  const normalized = normalizeTelegramId(chatId);
  return normalized ? getAuditChatIds().includes(normalized) : false;
}

function truncateText(input, maxLength = TELEGRAM_MESSAGE_LIMIT) {
  const text = String(input ?? "").trim();
  if (!text) {
    return "-";
  }
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function splitTextIntoChunks(input, maxLength = TELEGRAM_MESSAGE_LIMIT) {
  const text = String(input ?? "");
  if (!text) {
    return [];
  }

  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    let splitIndex = remaining.lastIndexOf("\n", maxLength);
    if (splitIndex < Math.floor(maxLength / 2)) {
      splitIndex = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitIndex < Math.floor(maxLength / 2)) {
      splitIndex = maxLength;
    }
    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trimStart();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

function formatTelegramUser(from) {
  if (!from) {
    return "Unknown user";
  }

  const fullName = [from.first_name, from.last_name].filter(Boolean).join(" ").trim();
  const username = from.username ? ` @${from.username}` : "";
  return `${fullName || "Unknown user"}${username} (id: ${from.id})`;
}

function formatTelegramChat(chat, fallbackChatId) {
  const chatId = normalizeTelegramId(chat?.id ?? fallbackChatId) || "unknown";
  const chatType = chat?.type || "unknown";
  const title = chat?.title || [chat?.first_name, chat?.last_name].filter(Boolean).join(" ").trim();
  const username = chat?.username ? ` @${chat.username}` : "";
  return `${title || "Unknown chat"}${username} [${chatType}] (id: ${chatId})`;
}

function describeMessageContent(message) {
  if (!message) {
    return "";
  }
  if (message.text) {
    return `Message:\n${truncateText(message.text, 3200)}`;
  }
  if (message.caption) {
    return `Caption:\n${truncateText(message.caption, 2800)}`;
  }
  if (message.document) {
    return `Document: ${message.document.file_name || "unnamed"} (${message.document.mime_type || "unknown"})`;
  }
  if (message.photo) {
    return `Photo${message.caption ? `\nCaption:\n${truncateText(message.caption, 2600)}` : ""}`;
  }
  if (message.sticker) {
    return `Sticker: ${message.sticker.emoji || "sticker"}`;
  }
  if (message.voice) {
    return "Voice message";
  }
  if (message.audio) {
    return `Audio: ${message.audio.title || message.audio.file_name || "audio"}`;
  }
  if (message.video) {
    return "Video";
  }
  if (message.video_note) {
    return "Video note";
  }
  if (message.location) {
    return `Location: ${message.location.latitude}, ${message.location.longitude}`;
  }
  if (message.contact) {
    return `Contact: ${message.contact.first_name || ""} ${message.contact.phone_number || ""}`.trim();
  }
  if (message.poll) {
    return `Poll: ${message.poll.question || "-"}`;
  }
  return `Message type: ${Object.keys(message).filter((key) => !["message_id", "from", "chat", "date"].includes(key))[0] || "unknown"}`;
}

function buildIncomingAuditMessage(ctx) {
  const updateType = ctx?.updateType || "unknown";
  const chatId = normalizeTelegramId(ctx?.chat?.id);

  if (ctx?.message) {
    return [
      "#UserToBot",
      `Update type: ${updateType}`,
      `Chat: ${formatTelegramChat(ctx.chat)}`,
      `User: ${formatTelegramUser(ctx.from)}`,
      "",
      describeMessageContent(ctx.message),
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (ctx?.callbackQuery) {
    return [
      "#UserToBot",
      `Update type: ${updateType}`,
      `Chat: ${formatTelegramChat(ctx.chat, chatId)}`,
      `User: ${formatTelegramUser(ctx.from)}`,
      "",
      `Callback data:\n${truncateText(ctx.callbackQuery.data, 3200)}`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

function buildOutgoingTextAuditMessage({ chatId, message, method, ctx }) {
  return [
    "#BotToUser",
    `Method: ${method}`,
    `Target chat: ${formatTelegramChat(ctx?.chat, chatId)}`,
    ctx?.from ? `Triggered by: ${formatTelegramUser(ctx.from)}` : "",
    "",
    `Message:\n${truncateText(message, 3200)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildOutgoingDocumentAuditMessage({ chatId, filePath, options = {}, ctx }) {
  const fileName = path.basename(String(filePath || "").trim() || "document");
  return [
    "#BotToUser",
    "Method: document",
    `Target chat: ${formatTelegramChat(ctx?.chat, chatId)}`,
    ctx?.from ? `Triggered by: ${formatTelegramUser(ctx.from)}` : "",
    "",
    `Document: ${fileName}`,
    options.caption ? `Caption:\n${truncateText(options.caption, 1200)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildAuditDocumentCaption(chatId, options = {}) {
  const base = [
    "Audit copy",
    `target: ${normalizeTelegramId(chatId) || "unknown"}`,
    options.caption ? `caption: ${truncateText(options.caption, 160)}` : "",
  ]
    .filter(Boolean)
    .join(" | ");

  return truncateText(base, TELEGRAM_CAPTION_LIMIT);
}

async function directSendMessage(chatId, message, options = {}) {
  return getTelegramBot().telegram.sendMessage(chatId, message, {
    disable_web_page_preview: true,
    ...(options.extra || {}),
  });
}

async function directSendDocument(chatId, filePath, options = {}) {
  return getTelegramBot().telegram.sendDocument(
    chatId,
    {
      source: filePath,
    },
    {
      caption: options.caption,
      ...(options.extra || {}),
    },
  );
}

async function directEditMessageText(chatId, messageId, message, options = {}) {
  return getTelegramBot().telegram.editMessageText(chatId, messageId, undefined, message, options.extra || {});
}

async function sendAuditText(message, options = {}) {
  const auditChatIds = getAuditChatIds();
  if (auditChatIds.length === 0) {
    return;
  }

  const excluded = new Set(
    [options.excludeChatId, ...(Array.isArray(options.excludeChatIds) ? options.excludeChatIds : [])]
      .map((item) => normalizeTelegramId(item))
      .filter(Boolean),
  );

  for (const auditChatId of auditChatIds) {
    if (excluded.has(auditChatId)) {
      continue;
    }

    const chunks = splitTextIntoChunks(message);
    for (const chunk of chunks) {
      try {
        await directSendMessage(auditChatId, chunk);
      } catch (error) {
        logger.error("Failed to send Telegram audit text", {
          auditChatId,
          error: error.message,
        });
        break;
      }
    }
  }
}

async function sendAuditDocument(filePath, options = {}) {
  const auditChatIds = getAuditChatIds();
  if (auditChatIds.length === 0) {
    return;
  }

  const excluded = new Set(
    [options.excludeChatId, ...(Array.isArray(options.excludeChatIds) ? options.excludeChatIds : [])]
      .map((item) => normalizeTelegramId(item))
      .filter(Boolean),
  );

  for (const auditChatId of auditChatIds) {
    if (excluded.has(auditChatId)) {
      continue;
    }

    try {
      await directSendDocument(auditChatId, filePath, { caption: options.caption });
    } catch (error) {
      logger.error("Failed to send Telegram audit document", {
        auditChatId,
        filePath,
        error: error.message,
      });
    }
  }
}

async function auditIncomingUpdate(ctx) {
  const sourceChatId = normalizeTelegramId(ctx?.chat?.id);
  if (!ctx || isAuditChat(sourceChatId)) {
    return;
  }

  const auditMessage = buildIncomingAuditMessage(ctx);
  if (!auditMessage) {
    return;
  }

  await sendAuditText(auditMessage);
}

function attachAuditToContext(ctx) {
  if (!ctx || ctx.__auditAttached) {
    return ctx;
  }

  ctx.__auditAttached = true;

  const targetChatId = normalizeTelegramId(ctx.chat?.id);
  const skipAudit = isAuditChat(targetChatId);

  if (typeof ctx.reply === "function") {
    const originalReply = ctx.reply.bind(ctx);
    ctx.reply = async (message, extra) => {
      const result = await originalReply(message, extra);
      if (!skipAudit) {
        await sendAuditText(buildOutgoingTextAuditMessage({ chatId: targetChatId, message, method: "reply", ctx }), {
          excludeChatId: targetChatId,
        }).catch((error) => {
          logger.error("Failed auditing ctx.reply", { error: error.message, targetChatId });
        });
      }
      return result;
    };
  }

  if (typeof ctx.editMessageText === "function") {
    const originalEditMessageText = ctx.editMessageText.bind(ctx);
    ctx.editMessageText = async (message, extra) => {
      const result = await originalEditMessageText(message, extra);
      if (!skipAudit) {
        await sendAuditText(
          buildOutgoingTextAuditMessage({ chatId: targetChatId, message, method: "editMessageText", ctx }),
          { excludeChatId: targetChatId },
        ).catch((error) => {
          logger.error("Failed auditing ctx.editMessageText", { error: error.message, targetChatId });
        });
      }
      return result;
    };
  }

  return ctx;
}

async function safeSendMessage(chatId, message, options = {}) {
  const normalizedChatId = normalizeTelegramId(chatId);
  try {
    const result = await directSendMessage(chatId, message, { extra: options.extra });
    if (!isAuditChat(normalizedChatId)) {
      await sendAuditText(
        buildOutgoingTextAuditMessage({
          chatId: normalizedChatId,
          message,
          method: "safeSendMessage",
        }),
        { excludeChatId: normalizedChatId },
      );
    }
    return result;
  } catch (error) {
    logger.error("Failed to send Telegram message", {
      chatId,
      error: error.message,
    });
    return null;
  }
}

async function safeSendDocument(chatId, filePath, options = {}) {
  const normalizedChatId = normalizeTelegramId(chatId);
  try {
    await directSendDocument(chatId, filePath, options);
    if (!isAuditChat(normalizedChatId)) {
      await sendAuditText(
        buildOutgoingDocumentAuditMessage({
          chatId: normalizedChatId,
          filePath,
          options,
        }),
        { excludeChatId: normalizedChatId },
      );
      await sendAuditDocument(filePath, {
        caption: buildAuditDocumentCaption(normalizedChatId, options),
        excludeChatId: normalizedChatId,
      });
    }
  } catch (error) {
    logger.error("Failed to send Telegram document", {
      chatId,
      filePath,
      error: error.message,
    });
  }
}

async function safeEditMessageText(chatId, messageId, message, options = {}) {
  const normalizedChatId = normalizeTelegramId(chatId);
  try {
    const result = await directEditMessageText(chatId, messageId, message, options);
    if (!isAuditChat(normalizedChatId)) {
      await sendAuditText(
        buildOutgoingTextAuditMessage({
          chatId: normalizedChatId,
          message,
          method: "safeEditMessageText",
        }),
        { excludeChatId: normalizedChatId },
      );
    }
    return result;
  } catch (error) {
    if (/message is not modified/i.test(String(error?.message || ""))) {
      return null;
    }

    logger.error("Failed to edit Telegram message", {
      chatId,
      messageId,
      error: error.message,
    });
    return null;
  }
}

module.exports = {
  attachAuditToContext,
  auditIncomingUpdate,
  initTelegramBot,
  getTelegramBot,
  safeEditMessageText,
  safeSendMessage,
  safeSendDocument,
};
