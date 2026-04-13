const TelegramUser = require("../models/TelegramUser");

function parseConfiguredTelegramIds() {
  const raw = process.env.SHARED_ALLOWED_TELEGRAM_IDS || "";
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseConfiguredGroupChatIds() {
  const raw = process.env.NOTIFICATION_GROUP_CHAT_IDS || "";
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getSharedScopeMode() {
  const mode = String(process.env.SHARED_SCOPE_MODE || "all")
    .trim()
    .toLowerCase();
  if (mode === "allowlist" || mode === "off") {
    return mode;
  }
  return "all";
}

function getAccessibleTelegramIds(requesterTelegramId) {
  const requester = String(requesterTelegramId || "").trim();
  const configured = parseConfiguredTelegramIds();
  const mode = getSharedScopeMode();

  if (mode === "all") {
    return requester ? [requester] : [];
  }

  if (mode === "off") {
    return requester ? [requester] : [];
  }

  if (!requester) {
    return configured;
  }

  // Shared mode is enabled only if requester is part of the configured list.
  if (configured.length >= 2 && configured.includes(requester)) {
    return configured;
  }

  return [requester];
}

async function resolveSharedScope(requesterTelegramId, fallbackUserId) {
  const mode = getSharedScopeMode();
  let users = [];

  if (mode === "all") {
    users = await TelegramUser.find({}).select("_id telegramId");
  } else {
    const telegramIds = getAccessibleTelegramIds(requesterTelegramId);
    users = await TelegramUser.find({ telegramId: { $in: telegramIds } }).select("_id telegramId");
  }

  const userIds = users.map((user) => user._id);
  const telegramIds = users.map((user) => String(user.telegramId));

  if (fallbackUserId && !userIds.some((id) => String(id) === String(fallbackUserId))) {
    userIds.push(fallbackUserId);
  }

  return {
    telegramIds,
    userIds,
  };
}

async function getNotificationChatIds(ownerTelegramId) {
  const scope = await resolveSharedScope(ownerTelegramId);
  const groupIds = parseConfiguredGroupChatIds();
  return [...new Set([...scope.telegramIds, ...groupIds])];
}

function getGroupChatIds() {
  return parseConfiguredGroupChatIds();
}

module.exports = {
  getAccessibleTelegramIds,
  resolveSharedScope,
  getNotificationChatIds,
  getGroupChatIds,
};
