const OutlookAccount = require("../models/OutlookAccount");
const { decrypt, encrypt } = require("../utils/crypto");
const logger = require("../utils/logger").withContext("OutlookService");
const { microsoftScopes } = require("./oauthService");
const { runtimeConfig } = require("../config/runtime");

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAIL_FOLDER_ALIASES = {
  inbox: ["inbox", "mailinbox", "البريدالوارد"],
  junkemail: [
    "junkemail",
    "junkmail",
    "junk",
    "spam",
    "junk e-mail",
    "junk email",
    "بريدمزعج",
    "رسائلغيرمرغوبفيها",
    "البريدغيرالهام",
    "بريدغيرهام",
  ],
};

function getTenantId() {
  return process.env.MS_TENANT_ID || "common";
}

function decodeToken(tokenPayload) {
  return decrypt(tokenPayload);
}

function setTokenFields(account, accessToken, refreshToken, expiresAt) {
  account.accessToken = encrypt(accessToken);
  if (refreshToken) {
    account.refreshToken = encrypt(refreshToken);
  }
  account.expiresAt = new Date(expiresAt);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(headerValue) {
  if (!headerValue) {
    return null;
  }

  const asNumber = Number.parseInt(String(headerValue), 10);
  if (!Number.isNaN(asNumber) && asNumber >= 0) {
    return asNumber * 1000;
  }

  const asDate = new Date(String(headerValue)).getTime();
  if (!Number.isNaN(asDate)) {
    const delay = asDate - Date.now();
    return delay > 0 ? delay : 0;
  }

  return null;
}

function buildRetryDelay(attempt, retryAfterMs) {
  if (typeof retryAfterMs === "number") {
    return Math.min(Math.max(retryAfterMs, 500), 30000);
  }
  const base = 500 * 2 ** attempt;
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(base + jitter, 30000);
}

function normalizeFolderLookupValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function getCanonicalFolderName(folderName) {
  const normalized = normalizeFolderLookupValue(folderName);
  if (!normalized) {
    return "inbox";
  }

  for (const [canonicalName, aliases] of Object.entries(MAIL_FOLDER_ALIASES)) {
    const normalizedAliases = aliases.map((alias) => normalizeFolderLookupValue(alias));
    if (normalized === canonicalName || normalizedAliases.includes(normalized)) {
      return canonicalName;
    }
  }

  return normalized;
}

function shouldFallbackToClientSideSenderFilter(error) {
  const message = String(error?.message || "");
  return (
    /InefficientFilter/i.test(message) ||
    /ErrorInvalidUrlQueryFilter/i.test(message) ||
    /restriction or sort order is too complex/i.test(message) ||
    /unsupported.*filter/i.test(message) ||
    /cannot be completed because the restriction/i.test(message)
  );
}

async function listRootMailFolders(account) {
  const query = new URLSearchParams({
    $select: "id,displayName,isHidden,totalItemCount,unreadItemCount",
    $top: "100",
  });

  const folders = [];
  let url = `/me/mailFolders?includeHiddenFolders=true&${query.toString()}`;

  while (url) {
    const data = await graphRequest(account, url);
    if (Array.isArray(data.value)) {
      folders.push(...data.value);
    }
    url = data["@odata.nextLink"] ? data["@odata.nextLink"].replace(/^.*\/me/, "") : null;
  }

  return folders;
}

async function resolveMailFolder(account, folderName) {
  const canonicalName = getCanonicalFolderName(folderName);
  const encodedFolderName = encodeURIComponent(canonicalName);

  try {
    const folder = await graphRequest(
      account,
      `/me/mailFolders/${encodedFolderName}?$select=id,displayName,isHidden,totalItemCount,unreadItemCount`,
    );
    if (folder?.id) {
      return {
        id: folder.id,
        name: folder.displayName || canonicalName,
        source: "well-known",
      };
    }
  } catch (error) {
    logger.warn("Failed resolving mail folder by well-known name", {
      accountId: String(account._id),
      requestedFolder: folderName,
      canonicalFolder: canonicalName,
      error: error.message,
    });
  }

  const aliases = new Set([canonicalName, ...(MAIL_FOLDER_ALIASES[canonicalName] || [])].map(normalizeFolderLookupValue));
  const folders = await listRootMailFolders(account);
  const match = folders.find((folder) => aliases.has(normalizeFolderLookupValue(folder?.displayName)));

  if (match?.id) {
    return {
      id: match.id,
      name: match.displayName || canonicalName,
      source: "display-name",
    };
  }

  throw new Error(`Mail folder not found: ${folderName}`);
}

async function refreshAccessToken(account) {
  const refreshToken = decodeToken(account.refreshToken);
  if (!refreshToken) {
    throw new Error("Missing refresh token. Reconnect Outlook account.");
  }

  const tenantId = getTenantId();
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID,
    client_secret: process.env.MS_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: microsoftScopes.join(" "),
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await response.json();

  if (!response.ok || !data.access_token) {
    throw new Error(`Refresh token failed: ${data.error_description || data.error || "unknown error"}`);
  }

  logger.info("Access token refreshed", {
    accountId: String(account._id),
    expiresInSeconds: Number(data.expires_in || 3600),
  });

  const expiresAt = new Date(Date.now() + Number(data.expires_in || 3600) * 1000);
  setTokenFields(account, data.access_token, data.refresh_token, expiresAt);
  account.isActive = true;
  account.lastError = null;
  account.consecutiveFailures = 0;
  account.disabledAt = null;
  account.reconnectRequired = false;
  await account.save();

  return data.access_token;
}

async function ensureAccessToken(account) {
  const now = Date.now();
  const expiresAtMs = new Date(account.expiresAt).getTime();
  const shouldRefresh = !expiresAtMs || expiresAtMs - now < 60 * 1000;

  if (shouldRefresh) {
    return refreshAccessToken(account);
  }

  const token = decodeToken(account.accessToken);
  if (!token) {
    return refreshAccessToken(account);
  }

  return token;
}

async function graphRequest(account, path, options = {}) {
  const maxRetries = Number(options.maxRetries ?? runtimeConfig.graphRequestMaxRetries);
  let accessToken = await ensureAccessToken(account);
  const url = `${GRAPH_BASE}${path}`;
  let refreshed = false;

  logger.debug("Graph request started", {
    accountId: String(account._id),
    path,
    maxRetries,
  });

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (response.status === 401 && !refreshed) {
      logger.warn("Graph 401 received, trying token refresh", {
        accountId: String(account._id),
      });
      accessToken = await refreshAccessToken(account);
      refreshed = true;
      continue;
    }

    if (response.ok) {
      if (response.status === 204) {
        return null;
      }
      const text = await response.text();
      if (!text) {
        return null;
      }
      try {
        return JSON.parse(text);
      } catch (_error) {
        return { raw: text };
      }
    }

    const responseText = await response.text();
    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterMs = parseRetryAfter(retryAfterHeader);
    const isTransient = TRANSIENT_STATUS.has(response.status);

    if (isTransient && attempt < maxRetries) {
      const delayMs = buildRetryDelay(attempt, retryAfterMs);
      logger.warn("Transient Graph error, retrying", {
        accountId: String(account._id),
        status: response.status,
        attempt,
        delayMs,
      });
      await sleep(delayMs);
      continue;
    }

    throw new Error(`Graph request failed [${response.status}]: ${responseText}`);
  }

  throw new Error("Graph request exhausted retries without success.");
}

async function getMailboxProfile(account) {
  return graphRequest(account, "/me?$select=id,mail,userPrincipalName,displayName");
}

async function getInboxMessagesSince(account, sinceDate, options = {}) {
  const overlapSeconds = Number(options.overlapSeconds ?? runtimeConfig.fetchOverlapSeconds);
  const since = sinceDate
    ? new Date(new Date(sinceDate).getTime() - Math.max(overlapSeconds, 0) * 1000)
    : new Date(Date.now() - 5 * 60 * 1000);
  const iso = since.toISOString();
  const pageSize = Number(options.pageSize || runtimeConfig.graphPageSize);
  const maxPages = Number(options.maxPages || runtimeConfig.graphMaxPages);

  const query = new URLSearchParams({
    $select: "id,internetMessageId,from,subject,receivedDateTime,bodyPreview,hasAttachments",
    $orderby: "receivedDateTime desc",
    $top: String(pageSize),
    $filter: `receivedDateTime ge ${iso}`,
  });

  const allMessages = [];
  let url = `/me/mailFolders/inbox/messages?${query.toString()}`;
  let pageCount = 0;

  try {
    while (url && pageCount < maxPages) {
      const data = await graphRequest(account, url);
      if (Array.isArray(data.value)) {
        allMessages.push(...data.value);
      }

      pageCount += 1;
      url = data["@odata.nextLink"] ? data["@odata.nextLink"].replace(/^.*\/me/, "") : null;

      if (pageCount >= maxPages) {
        logger.warn("Message pagination limit reached", {
          accountId: String(account._id),
          pagesProcessed: pageCount,
          messagesCollected: allMessages.length,
        });
        break;
      }
    }
  } catch (error) {
    logger.error("Error fetching paginated messages", {
      accountId: String(account._id),
      error: error.message,
      pagesProcessed: pageCount,
    });
    throw error;
  }

  return allMessages;
}

async function getInboxMessagesBySender(account, senderAddress, options = {}) {
  const sender = String(senderAddress || "")
    .trim()
    .toLowerCase();
  if (!sender) {
    return [];
  }

  const pageSize = Number(options.pageSize || runtimeConfig.graphPageSize);
  const maxPages = Number(options.maxPages || runtimeConfig.graphMaxPages);
  const folderName = String(options.folderName || "inbox").trim();
  const resolvedFolder = await resolveMailFolder(account, folderName);
  const folderMessagesPath = `/me/mailFolders/${encodeURIComponent(resolvedFolder.id)}/messages`;
  const escapedSender = sender.replace(/'/g, "''");
  const sortMessagesByReceivedDateDesc = (messages) =>
    messages
      .slice()
      .sort((a, b) => new Date(b?.receivedDateTime || 0).getTime() - new Date(a?.receivedDateTime || 0).getTime());

  const query = new URLSearchParams({
    $select: "id,internetMessageId,from,subject,receivedDateTime,bodyPreview,hasAttachments",
    $top: String(pageSize),
    $filter: `from/emailAddress/address eq '${escapedSender}'`,
  });

  const allMessages = [];

  try {
    let url = `${folderMessagesPath}?${query.toString()}`;
    let pageCount = 0;

    while (url && pageCount < maxPages) {
      const data = await graphRequest(account, url);
      if (Array.isArray(data.value)) {
        allMessages.push(...data.value);
      }

      pageCount += 1;
      url = data["@odata.nextLink"] ? data["@odata.nextLink"].replace(/^.*\/me/, "") : null;
    }

    return sortMessagesByReceivedDateDesc(allMessages);
  } catch (error) {
    if (!shouldFallbackToClientSideSenderFilter(error)) {
      throw error;
    }

    logger.warn("Falling back to client-side sender filter", {
      accountId: String(account._id),
      sender,
      folderName: resolvedFolder.name,
      folderSource: resolvedFolder.source,
      reason: error.message,
    });

    const fallbackQuery = new URLSearchParams({
      $select: "id,internetMessageId,from,subject,receivedDateTime,bodyPreview,hasAttachments",
      $orderby: "receivedDateTime desc",
      $top: String(pageSize),
    });

    const matched = [];
    let fallbackUrl = `${folderMessagesPath}?${fallbackQuery.toString()}`;
    let fallbackPages = 0;

    while (fallbackUrl && fallbackPages < maxPages) {
      const data = await graphRequest(account, fallbackUrl);
      if (Array.isArray(data.value)) {
        for (const message of data.value) {
          const from = String(message?.from?.emailAddress?.address || "")
            .trim()
            .toLowerCase();
          if (from === sender) {
            matched.push(message);
          }
        }
      }

      fallbackPages += 1;
      fallbackUrl = data["@odata.nextLink"] ? data["@odata.nextLink"].replace(/^.*\/me/, "") : null;
    }

    return sortMessagesByReceivedDateDesc(matched);
  }
}

async function getFullMessageBody(account, messageId) {
  const encodedId = encodeURIComponent(messageId);
  const data = await graphRequest(
    account,
    `/me/messages/${encodedId}?$select=id,body,bodyPreview,subject,from,receivedDateTime`,
  );
  return {
    bodyText: data?.body?.content || "",
    bodyPreview: data?.bodyPreview || "",
    subject: data?.subject || "",
  };
}

async function markAccountError(account, error) {
  account.lastError = error.message;
  account.consecutiveFailures = Number(account.consecutiveFailures || 0) + 1;

  const authFailure = /Refresh token failed|Missing refresh token|invalid_grant|interaction_required/i.test(
    error.message,
  );
  const tooManyFailures = account.consecutiveFailures >= runtimeConfig.maxConsecutiveFailures;

  if (authFailure || tooManyFailures) {
    account.reconnectRequired = true;
    account.disabledAt = new Date();
    account.isActive = false;
  }

  await account.save();
  logger.error("Account sync error", {
    accountId: String(account._id),
    error: error.message,
    consecutiveFailures: account.consecutiveFailures,
    reconnectRequired: account.reconnectRequired,
  });
}

async function markAccountHealthy(account, newestReceivedDate) {
  if (newestReceivedDate) {
    account.lastSyncAt = new Date(newestReceivedDate);
  }
  account.lastSuccessAt = new Date();
  account.lastError = null;
  account.consecutiveFailures = 0;
  account.reconnectRequired = false;
  account.disabledAt = null;
  if (!account.isActive) {
    account.isActive = true;
  }
  await account.save();
}

async function upsertOutlookAccount({ telegramUserId, email, accessToken, refreshToken, expiresAt, accountId }) {
  if (!refreshToken) {
    throw new Error("No refresh token was returned. Ensure offline_access is granted and reconnect.");
  }

  const existing = await OutlookAccount.findOne({ telegramUserId, email: email.toLowerCase() });
  const doc = existing || new OutlookAccount({ telegramUserId, email: email.toLowerCase(), accountId });

  doc.accountId = accountId;
  doc.isActive = true;
  doc.lastError = null;
  doc.consecutiveFailures = 0;
  doc.reconnectRequired = false;
  doc.disabledAt = null;
  if (!doc.connectedAt) {
    doc.connectedAt = new Date();
  }

  setTokenFields(doc, accessToken, refreshToken, expiresAt);
  await doc.save();

  return doc;
}

module.exports = {
  ensureAccessToken,
  graphRequest,
  getMailboxProfile,
  getInboxMessagesSince,
  getInboxMessagesBySender,
  getFullMessageBody,
  markAccountError,
  markAccountHealthy,
  upsertOutlookAccount,
};
