const cron = require("node-cron");
const OutlookAccount = require("../models/OutlookAccount");
const MailLog = require("../models/MailLog");
const NotificationRule = require("../models/NotificationRule");
const TelegramUser = require("../models/TelegramUser");
const { getInboxMessagesSince, getFullMessageBody, markAccountError, markAccountHealthy } = require("./outlookService");
const { safeSendMessage } = require("./telegramService");
const { extractCode } = require("./codeExtractionService");
const { buildOtpNotification } = require("./notificationTemplates");
const { matchProvider } = require("./providerEngine");
const { asyncPool } = require("../utils/asyncPool");
const logger = require("../utils/logger").withContext("PollingService");
const { runtimeConfig } = require("../config/runtime");

let pollingTask = null;

function toProviderOverrides(notificationRules) {
  return notificationRules
    .filter((rule) => rule.isActive)
    .map((rule) => ({
      name: rule.providerKey || "Custom",
      key: rule.providerKey || `custom-${String(rule._id)}`,
      priority: Number(rule.priority || 0),
      strict: rule.strict !== false,
      senderExact: rule.senderExact ? [rule.senderExact] : [],
      senderContains: rule.senderContains ? [rule.senderContains] : [],
      senderDomain: rule.senderDomain ? [rule.senderDomain] : [],
      subjectContains: rule.subjectContains ? [rule.subjectContains] : [],
      bodyContains: rule.bodyContains ? [rule.bodyContains] : [],
      codeRegex: rule.codeRegex || null,
    }));
}

function isDuplicateKeyError(error) {
  return Boolean(error && (error.code === 11000 || /duplicate key/i.test(error.message || "")));
}

function nowMs() {
  return Date.now();
}

async function processAccount(account, options = {}) {
  const startedAt = nowMs();
  const telegramUser = await TelegramUser.findById(account.telegramUserId);
  if (!telegramUser) {
    return { checked: 0, notified: 0, matched: 0, duplicateSkipped: 0, nonMatchingSkipped: 0 };
  }

  try {
    logger.info("Processing account", {
      accountId: String(account._id),
      email: account.email,
      telegramUserId: String(account.telegramUserId),
    });

    const ruleDocs = await NotificationRule.find({
      telegramUserId: account.telegramUserId,
      accountId: account._id,
      isActive: true,
    });
    const providerOverrides = toProviderOverrides(ruleDocs);

    const messages = await getInboxMessagesSince(account, account.lastSyncAt, {
      pageSize: runtimeConfig.graphPageSize,
      maxPages: runtimeConfig.graphMaxPages,
      overlapSeconds: runtimeConfig.fetchOverlapSeconds,
    });

    const sorted = messages.sort(
      (a, b) => new Date(a.receivedDateTime).getTime() - new Date(b.receivedDateTime).getTime(),
    );

    let notifiedCount = 0;
    let matchedCount = 0;
    let duplicateSkipped = 0;
    let nonMatchingSkipped = 0;
    let newestReceivedDate = account.lastSyncAt ? new Date(account.lastSyncAt) : null;
    const debugEvents = [];

    for (const message of sorted) {
      try {
        const messageId = message.id;
        const received = message.receivedDateTime ? new Date(message.receivedDateTime) : null;
        if (received && (!newestReceivedDate || received > newestReceivedDate)) {
          newestReceivedDate = received;
        }

        const alreadyLogged = await MailLog.findOne({ accountId: account._id, messageId });
        if (alreadyLogged) {
          duplicateSkipped += 1;
          if (options.debug) {
            debugEvents.push({ messageId, reason: "duplicate" });
          }
          continue;
        }

        const providerDecision = matchProvider(message, {
          providers: providerOverrides,
        });

        if (!providerDecision.matched) {
          nonMatchingSkipped += 1;
          if (options.debug) {
            debugEvents.push({
              messageId,
              reason: providerDecision.reason,
              sender: providerDecision.debug.senderEmail,
              domain: providerDecision.debug.senderDomain,
              subject: providerDecision.debug.subject,
            });
          }
          continue;
        }
        matchedCount += 1;

        let extraction = extractCode(message, {
          providerCodeRegex: providerDecision.provider?.codeRegex,
        });

        if (!extraction.code) {
          const fullBody = await getFullMessageBody(account, messageId);
          extraction = extractCode(
            {
              ...message,
              bodyPreview: fullBody.bodyPreview || message.bodyPreview,
              subject: fullBody.subject || message.subject,
            },
            {
              providerCodeRegex: providerDecision.provider?.codeRegex,
              fullBodyHtml: fullBody.bodyText,
            },
          );
        }

        if (!extraction.code) {
          nonMatchingSkipped += 1;
          if (options.debug) {
            debugEvents.push({
              messageId,
              reason: "code_not_found",
              provider: providerDecision.provider?.key,
            });
          }
          continue;
        }

        if (!options.dryRun) {
          try {
            const notificationMessage = buildOtpNotification({
              language: telegramUser.preferredLanguage,
              provider: providerDecision.provider,
              code: extraction.code,
              accountEmail: account.email,
            });

            await safeSendMessage(telegramUser.telegramId, notificationMessage);

            try {
              await MailLog.create({
                accountId: account._id,
                messageId,
                provider: providerDecision.provider?.key || null,
                extractedCode: extraction.code,
                notifiedAt: new Date(),
              });
            } catch (insertError) {
              if (!isDuplicateKeyError(insertError)) {
                throw insertError;
              }
              duplicateSkipped += 1;
              continue;
            }
          } catch (notifyError) {
            logger.error("Failed to send notification for message", {
              messageId,
              error: notifyError.message,
              accountId: String(account._id),
            });
            continue;
          }
        }

        notifiedCount += 1;

        if (options.debug) {
          debugEvents.push({
            messageId,
            reason: "notified",
            provider: providerDecision.provider?.key,
            extractedCode: extraction.code,
            extractionSource: extraction.source,
          });
        }
      } catch (msgError) {
        logger.error("Error processing individual message", {
          accountId: String(account._id),
          error: msgError.message,
        });
        continue;
      }
    }

    await markAccountHealthy(account, newestReceivedDate);

    const durationMs = nowMs() - startedAt;
    logger.info("Account processed", {
      accountId: String(account._id),
      email: account.email,
      fetchedMessages: sorted.length,
      matchedMessages: matchedCount,
      duplicateSkipped,
      nonMatchingSkipped,
      notificationsSent: notifiedCount,
      durationMs,
    });

    const result = {
      checked: sorted.length,
      notified: notifiedCount,
      matched: matchedCount,
      duplicateSkipped,
      nonMatchingSkipped,
      durationMs,
    };

    if (options.debug) {
      result.debugEvents = debugEvents.slice(0, 25);
    }

    return result;
  } catch (error) {
    await markAccountError(account, error);
    return {
      checked: 0,
      notified: 0,
      matched: 0,
      duplicateSkipped: 0,
      nonMatchingSkipped: 0,
      durationMs: nowMs() - startedAt,
      error: error.message,
    };
  }
}

async function checkForUser(telegramId) {
  const debugEnabled = runtimeConfig.debugMailChecks;
  return checkForUserWithOptions(telegramId, { debug: debugEnabled });
}

async function checkForUserWithOptions(telegramId, options = {}) {
  const user = await TelegramUser.findOne({ telegramId: String(telegramId) });
  if (!user) {
    return { accounts: 0, checked: 0, notified: 0, matched: 0, duplicateSkipped: 0, nonMatchingSkipped: 0 };
  }

  const accounts = await OutlookAccount.find({
    telegramUserId: user._id,
    isActive: true,
  });

  let totalChecked = 0;
  let totalNotified = 0;
  let totalMatched = 0;
  let totalDuplicateSkipped = 0;
  let totalNonMatchingSkipped = 0;
  const debugEvents = [];

  const results = await asyncPool(accounts, runtimeConfig.accountProcessConcurrency, async (account) => {
    try {
      return await processAccount(account, options);
    } catch (error) {
      await markAccountError(account, error);
      return { checked: 0, notified: 0, matched: 0, duplicateSkipped: 0, nonMatchingSkipped: 0, error: error.message };
    }
  });

  for (const result of results) {
    totalChecked += Number(result?.checked || 0);
    totalNotified += Number(result?.notified || 0);
    totalMatched += Number(result?.matched || 0);
    totalDuplicateSkipped += Number(result?.duplicateSkipped || 0);
    totalNonMatchingSkipped += Number(result?.nonMatchingSkipped || 0);
    if (Array.isArray(result?.debugEvents)) {
      debugEvents.push(...result.debugEvents);
    }
  }

  const summary = {
    accounts: accounts.length,
    checked: totalChecked,
    notified: totalNotified,
    matched: totalMatched,
    duplicateSkipped: totalDuplicateSkipped,
    nonMatchingSkipped: totalNonMatchingSkipped,
  };

  if (options.debug) {
    summary.debugEvents = debugEvents.slice(0, 100);
  }

  return summary;
}

async function checkAllAccounts() {
  const accounts = await OutlookAccount.find({ isActive: true });

  await asyncPool(accounts, runtimeConfig.accountProcessConcurrency, async (account) => {
    try {
      await processAccount(account, { debug: runtimeConfig.debugMailChecks });
    } catch (error) {
      await markAccountError(account, error);
    }
  });
}

function startPolling() {
  if (pollingTask) {
    pollingTask.stop();
    pollingTask = null;
  }

  const intervalSeconds = Number(process.env.POLL_INTERVAL_SECONDS || 45);
  const safeSeconds = Number.isNaN(intervalSeconds) ? 45 : Math.min(Math.max(intervalSeconds, 30), 60);
  const expression = `*/${safeSeconds} * * * * *`;

  pollingTask = cron.schedule(expression, async () => {
    try {
      await checkAllAccounts();
      logger.info("Polling cycle completed");
    } catch (error) {
      logger.error("Polling cycle failed", { error: error.message });
    }
  });

  logger.info("Polling started", { expression });
}

function stopPolling() {
  if (pollingTask) {
    pollingTask.stop();
    pollingTask = null;
  }
}

module.exports = {
  checkForUser,
  checkForUserWithOptions,
  processAccount,
  startPolling,
  stopPolling,
};
