const TelegramUser = require("../models/TelegramUser");

function parseConfiguredTelegramIds() {
  const raw = process.env.SHARED_ALLOWED_TELEGRAM_IDS || "";
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getAccessibleTelegramIds(requesterTelegramId) {
  const requester = String(requesterTelegramId || "").trim();
  const configured = parseConfiguredTelegramIds();

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
  const telegramIds = getAccessibleTelegramIds(requesterTelegramId);
  const users = await TelegramUser.find({ telegramId: { $in: telegramIds } }).select("_id telegramId");

  const userIds = users.map((user) => user._id);

  if (fallbackUserId && !userIds.some((id) => String(id) === String(fallbackUserId))) {
    userIds.push(fallbackUserId);
  }

  return {
    telegramIds,
    userIds,
  };
}

module.exports = {
  getAccessibleTelegramIds,
  resolveSharedScope,
};
