const { validateStateOrThrow, exchangeCodeForTokenSet } = require("../services/oauthService");
const { upsertOutlookAccount, getMailboxProfile } = require("../services/outlookService");
const { safeSendMessage } = require("../services/telegramService");
const { encrypt } = require("../utils/crypto");
const logger = require("../utils/logger").withContext("AuthController");

function buildConnectedMessage(language, email) {
  if (language === "en") {
    return `✅ Outlook account connected successfully:\n${email}`;
  }
  return `✅ تم ربط حساب Outlook بنجاح:\n${email}`;
}

function isEmailAllowed(email) {
  const allowedDomainsRaw = process.env.ALLOWED_MAIL_DOMAINS || "";
  const allowedDomains = allowedDomainsRaw
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

  if (!email) {
    return false;
  }

  if (allowedDomains.length === 0) {
    return true;
  }

  const domain = email.split("@")[1]?.toLowerCase();
  return Boolean(domain && allowedDomains.includes(domain));
}

async function microsoftCallback(req, res, next) {
  try {
    const { code, state, error, error_description: errorDescription } = req.query;

    logger.info("OAuth callback received", {
      code: code ? "present" : "missing",
      state: state ? "present" : "missing",
    });

    if (error) {
      logger.warn("OAuth error from Microsoft", { error, errorDescription });
      return res.status(400).send(`OAuth error: ${error}. ${errorDescription || ""}`);
    }

    if (!code || !state) {
      logger.error("Missing code or state in callback", { code, state });
      return res.status(400).send("Missing code or state in callback");
    }

    logger.info("Validating OAuth state");
    const telegramUser = await validateStateOrThrow(state);
    logger.info("State validated, telegram user found", { telegramId: telegramUser.telegramId });

    logger.info("Exchanging code for tokens");
    const tokenSet = await exchangeCodeForTokenSet(code);
    logger.info("Tokens received", {
      accessToken: tokenSet.accessToken ? "present" : "missing",
      hasRefreshToken: !!tokenSet.refreshToken,
    });

    const tempAccount = {
      accessToken: encrypt(tokenSet.accessToken),
      refreshToken: tokenSet.refreshToken ? encrypt(tokenSet.refreshToken) : null,
      expiresAt: tokenSet.expiresAt,
    };

    logger.info("Fetching mailbox profile from Graph");
    const profile = await getMailboxProfile(tempAccount);
    logger.info("Profile fetched", { mail: profile.mail, userPrincipalName: profile.userPrincipalName });

    const email = profile.mail || profile.userPrincipalName || tokenSet.email;
    logger.info("Email determined", { email, isAllowed: isEmailAllowed(email) });

    if (!email || !isEmailAllowed(email)) {
      logger.warn("Email not allowed or missing", { email });
      return res.status(403).send("This mailbox is not authorized for this bot.");
    }

    logger.info("Upserting Outlook account to database");
    const savedAccount = await upsertOutlookAccount({
      telegramUserId: telegramUser._id,
      email,
      accessToken: tokenSet.accessToken,
      refreshToken: tokenSet.refreshToken,
      expiresAt: tokenSet.expiresAt,
      accountId: tokenSet.accountId || profile.id,
    });
    logger.info("Account saved", { accountId: savedAccount._id, email: savedAccount.email });

    logger.info("Sending confirmation message to Telegram", { telegramId: telegramUser.telegramId });
    await safeSendMessage(
      telegramUser.telegramId,
      buildConnectedMessage(telegramUser.preferredLanguage, savedAccount.email),
    );
    logger.info("Confirmation message sent");

    return res.status(200).send("Outlook account connected. You can return to Telegram.");
  } catch (error) {
    logger.error("OAuth callback failed", { error: error.message });
    return next(error);
  }
}

module.exports = {
  microsoftCallback,
};
