const crypto = require("crypto");
const { getMsalClient, microsoftScopes } = require("../config/msal");
const TelegramUser = require("../models/TelegramUser");
const logger = require("../utils/logger");

function buildState(telegramId, nonce) {
  const payload = `${telegramId}:${nonce}`;
  return Buffer.from(payload, "utf8").toString("base64url");
}

function parseState(state) {
  try {
    const decoded = Buffer.from(state, "base64url").toString("utf8");
    const [telegramId, nonce] = decoded.split(":");
    if (!telegramId || !nonce) {
      return null;
    }
    return { telegramId, nonce };
  } catch (error) {
    return null;
  }
}

async function createAuthUrlForTelegramUser(telegramId) {
  const nonce = crypto.randomBytes(24).toString("hex");
  const state = buildState(telegramId, nonce);
  const normalizedTelegramId = String(telegramId);

  await TelegramUser.findOneAndUpdate(
    { telegramId: normalizedTelegramId },
    {
      $set: {
        telegramId: normalizedTelegramId,
        oauthState: nonce,
        oauthStateExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    },
    { new: true, upsert: true },
  );

  const msalClient = getMsalClient();
  const authUrl = await msalClient.getAuthCodeUrl({
    scopes: microsoftScopes,
    redirectUri: process.env.MS_REDIRECT_URI,
    state,
    prompt: "select_account",
  });

  return authUrl;
}

async function validateStateOrThrow(state) {
  const parsed = parseState(state);
  if (!parsed) {
    throw new Error("Invalid OAuth state");
  }

  const user = await TelegramUser.findOne({ telegramId: parsed.telegramId });
  if (!user) {
    throw new Error("Telegram user not found for state");
  }

  const isExpired = !user.oauthStateExpiresAt || user.oauthStateExpiresAt < new Date();
  const isValidNonce = user.oauthState && user.oauthState === parsed.nonce;

  if (isExpired || !isValidNonce) {
    throw new Error("OAuth state is invalid or expired");
  }

  user.oauthState = null;
  user.oauthStateExpiresAt = null;
  await user.save();

  return user;
}

function getRefreshTokenFromMsalCache(serializedCache, homeAccountId) {
  const parsed = JSON.parse(serializedCache || "{}");
  const entries = Object.values(parsed.RefreshToken || {});

  const rtEntry = entries.find((entry) => entry.home_account_id === homeAccountId);
  return rtEntry ? rtEntry.secret : null;
}

async function exchangeCodeForTokenSet(code) {
  const msalClient = getMsalClient();

  const result = await msalClient.acquireTokenByCode({
    code,
    scopes: microsoftScopes,
    redirectUri: process.env.MS_REDIRECT_URI,
  });

  if (!result || !result.accessToken || !result.account) {
    throw new Error("Failed to acquire token by authorization code");
  }

  const cache = msalClient.getTokenCache();
  const serialized = cache.serialize();
  const refreshToken = getRefreshTokenFromMsalCache(serialized, result.account.homeAccountId);

  if (!refreshToken) {
    logger.warn("Refresh token was not present in token cache; reconnection may be required", {
      homeAccountId: result.account.homeAccountId,
    });
  }

  return {
    accessToken: result.accessToken,
    refreshToken,
    expiresAt: result.expiresOn || new Date(Date.now() + 55 * 60 * 1000),
    accountId: result.account.homeAccountId,
    email: result.account.username || result.idTokenClaims?.preferred_username || null,
  };
}

module.exports = {
  createAuthUrlForTelegramUser,
  validateStateOrThrow,
  exchangeCodeForTokenSet,
  microsoftScopes,
};
