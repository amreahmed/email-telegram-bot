const TelegramUser = require("../models/TelegramUser");
const OutlookAccount = require("../models/OutlookAccount");
const { createAuthUrlForTelegramUser } = require("../services/oauthService");
const { checkForUser, checkForUserWithOptions } = require("../services/pollingService");
const { resolveSharedScope } = require("../services/sharedAccessService");
const logger = require("../utils/logger");

const ACCOUNTS_PAGE_SIZE = 50;

const LABELS = {
  ar: {
    connect: "🔐 ربط Outlook",
    accounts: "📧 الحسابات",
    checkNow: "🔄 فحص الآن",
    help: "ℹ️ المساعدة",
    language: "🌐 اللغة / Language",
    unlink: "🗑 فك ربط حساب",
  },
  en: {
    connect: "🔐 Connect Outlook",
    accounts: "📧 My Accounts",
    checkNow: "🔄 Check Now",
    help: "ℹ️ Help",
    language: "🌐 اللغة / Language",
    unlink: "🗑 Unlink Account",
  },
};

const TEXT = {
  ar: {
    menuTitle: "اختر الإجراء المطلوب:",
    menuPlaceholder: "اختر من القائمة...",
    connectIntro: "🔗 لإكمال الربط اضغط على الرابط التالي:",
    connectLinkLabel: "اضغط هنا",
    connectError: "❌ فشل إنشاء رابط الربط. حاول مرة أخرى.",
    noAccounts: '📭 لا توجد حسابات Outlook متصلة بعد.\n\nاستخدم زر "🔐 ربط Outlook".',
    accountsTitle: "📧 الحسابات المتصلة:\n\n",
    accountsPageInfo: "الصفحة",
    navPrev: "⬅️ السابق",
    navNext: "التالي ➡️",
    statusDone: "✅",
    statusOff: "❌",
    checkDone: "✅ تم الفحص بنجاح!",
    checkAccounts: "الحسابات",
    checkScanned: "الرسائل المفحوصة",
    checkSent: "إشعارات OTP المرسلة",
    checkMatched: "الرسائل المطابقة",
    checkDuplicates: "المكررة المتخطاة",
    checkNonMatching: "غير المطابقة",
    checkError: "❌ فشل الفحص. حاول مرة أخرى.",
    debugTitle: "🧪 نتائج فحص Debug",
    debugNoEvents: "لا توجد أحداث Debug حالية.",
    unlinkPrompt: "لفك ربط حساب، أرسل الأمر بهذا الشكل:\n" + "/unlink 1\n" + "أو\n" + "/unlink email@example.com",
    unlinkNoAccounts: "📭 لا توجد حسابات لفك ربطها.",
    unlinkBadInput: "❌ أدخل رقم الحساب من القائمة أو البريد الإلكتروني.",
    unlinkNotFound: "❌ لم يتم العثور على الحساب المطلوب.",
    unlinkDone: "✅ تم فك ربط الحساب بنجاح.",
    help:
      "📱 بوت OTP لـ Outlook\n\n" +
      "البوت يرسل لك أكواد التحقق تلقائيا من رسائل البريد.\n\n" +
      "طريقة العمل:\n" +
      "1. اربط حساب Outlook\n" +
      "2. البوت يراقب البريد تلقائيا\n" +
      "3. عند وصول رسالة OTP يصلك الكود مباشرة\n" +
      "4. الفحص كل 45 ثانية\n\n" +
      "الأزرار:\n" +
      "🔐 ربط Outlook - ربط البريد\n" +
      "📧 الحسابات - عرض الحسابات\n" +
      "🔄 فحص الآن - فحص يدوي\n" +
      "🗑 فك ربط حساب - إزالة حساب Outlook\n" +
      "🌐 اللغة / Language - تغيير اللغة\n\n" +
      "استخدم /start للعودة للقائمة.",
    switchedToArabic: "✅ تم تغيير اللغة إلى العربية.",
    switchedToEnglish: "✅ Language changed to English.",
    genericError: "❌ حدث خطأ غير متوقع. حاول مرة أخرى.",
  },
  en: {
    menuTitle: "Choose an action:",
    menuPlaceholder: "Choose an action...",
    connectIntro: "🔗 To authorize your Outlook mailbox, use this link:",
    connectLinkLabel: "Click here",
    connectError: "❌ Failed to generate OAuth link. Please try again.",
    noAccounts: '📭 No Outlook accounts connected yet.\n\nUse "🔐 Connect Outlook".',
    accountsTitle: "📧 Your connected accounts:\n\n",
    accountsPageInfo: "Page",
    navPrev: "⬅️ Prev",
    navNext: "Next ➡️",
    statusDone: "✅",
    statusOff: "❌",
    checkDone: "✅ Check complete!",
    checkAccounts: "Accounts",
    checkScanned: "Messages scanned",
    checkSent: "OTP notifications sent",
    checkMatched: "Matched messages",
    checkDuplicates: "Duplicate skips",
    checkNonMatching: "Non-matching skips",
    checkError: "❌ Failed to check inbox. Please try again.",
    debugTitle: "🧪 Debug Check Results",
    debugNoEvents: "No debug events available.",
    unlinkPrompt: "To unlink an account, send:\n" + "/unlink 1\n" + "or\n" + "/unlink email@example.com",
    unlinkNoAccounts: "📭 No connected accounts to unlink.",
    unlinkBadInput: "❌ Enter account number or email.",
    unlinkNotFound: "❌ Account not found.",
    unlinkDone: "✅ Account unlinked successfully.",
    help:
      "📱 Outlook OTP Bot\n\n" +
      "The bot automatically sends OTP codes from verification emails.\n\n" +
      "How it works:\n" +
      "1. Connect your Outlook account\n" +
      "2. The bot monitors your inbox automatically\n" +
      "3. OTP emails are forwarded instantly\n" +
      "4. Checks every 45 seconds\n\n" +
      "Buttons:\n" +
      "🔐 Connect Outlook - Link mailbox\n" +
      "📧 My Accounts - View connected accounts\n" +
      "🔄 Check Now - Manual check\n" +
      "🗑 Unlink Account - Remove Outlook account\n" +
      "🌐 اللغة / Language - Switch language\n\n" +
      "Use /start to return to menu.",
    switchedToArabic: "✅ تم تغيير اللغة إلى العربية.",
    switchedToEnglish: "✅ Language changed to English.",
    genericError: "❌ Unexpected error. Please try again.",
  },
};

function normalizeLanguage(value) {
  return value === "en" ? "en" : "ar";
}

function textFor(user, key) {
  const lang = normalizeLanguage(user?.preferredLanguage);
  return TEXT[lang][key];
}

function labelsFor(user) {
  const lang = normalizeLanguage(user?.preferredLanguage);
  return LABELS[lang];
}

async function getOrCreateTelegramUser(ctx) {
  const telegramId = String(ctx.from.id);
  const updates = {
    telegramId,
    username: ctx.from.username || null,
    firstName: ctx.from.first_name || null,
    preferredLanguage: "ar",
  };

  return TelegramUser.findOneAndUpdate(
    { telegramId },
    {
      $set: {
        telegramId,
        username: updates.username,
        firstName: updates.firstName,
      },
      $setOnInsert: {
        preferredLanguage: updates.preferredLanguage,
      },
    },
    { new: true, upsert: true },
  );
}

async function showMainMenu(ctx, user) {
  const labels = labelsFor(user);
  const keyboard = [
    [labels.connect, labels.accounts],
    [labels.checkNow, labels.help],
    [labels.unlink, labels.language],
  ];

  return ctx.reply(textFor(user, "menuTitle"), {
    reply_markup: {
      keyboard,
      resize_keyboard: true,
      one_time_keyboard: false,
      input_field_placeholder: textFor(user, "menuPlaceholder"),
    },
    disable_web_page_preview: true,
  });
}

async function handleStart(ctx) {
  const user = await getOrCreateTelegramUser(ctx);
  return showMainMenu(ctx, user);
}

async function handleConnect(ctx) {
  const user = await getOrCreateTelegramUser(ctx);
  try {
    const authUrl = await createAuthUrlForTelegramUser(ctx.from.id);
    const message = `${textFor(user, "connectIntro")}\n\n<a href="${authUrl}">${textFor(user, "connectLinkLabel")}</a>`;
    await ctx.reply(message, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  } catch (error) {
    logger.error("Error in connect handler", { error: error.message });
    await ctx.reply(textFor(user, "connectError"));
  }
}

async function handleAccounts(ctx) {
  const user = await getOrCreateTelegramUser(ctx);
  const scope = await resolveSharedScope(user.telegramId, user._id);
  const accounts = await OutlookAccount.find({
    telegramUserId: { $in: scope.userIds },
    isActive: true,
  }).sort({ connectedAt: -1 });

  if (accounts.length === 0) {
    return ctx.reply(textFor(user, "noAccounts"));
  }

  const fromCommand = ctx.message?.text || "";
  const pageMatch = fromCommand.match(/^\/accounts(?:@\w+)?\s+(\d+)/i);
  const requestedPage = pageMatch ? Number(pageMatch[1]) : 1;

  return renderAccountsPage(ctx, user, accounts, requestedPage, false);
}

function buildAccountsPageText(user, accounts, page, totalPages) {
  const start = (page - 1) * ACCOUNTS_PAGE_SIZE;
  const slice = accounts.slice(start, start + ACCOUNTS_PAGE_SIZE);

  const lines = slice.map((account, index) => {
    const globalIndex = start + index + 1;
    const status = account.isActive ? textFor(user, "statusDone") : textFor(user, "statusOff");
    return `${globalIndex}. ${status} ${account.email}`;
  });

  return (
    textFor(user, "accountsTitle") + lines.join("\n") + `\n\n${textFor(user, "accountsPageInfo")} ${page}/${totalPages}`
  );
}

function buildAccountsNav(user, page, totalPages) {
  const navRow = [];
  if (page > 1) {
    navRow.push({ text: textFor(user, "navPrev"), callback_data: `accounts:page:${page - 1}` });
  }
  if (page < totalPages) {
    navRow.push({ text: textFor(user, "navNext"), callback_data: `accounts:page:${page + 1}` });
  }

  if (navRow.length === 0) {
    return undefined;
  }

  return { inline_keyboard: [navRow] };
}

async function renderAccountsPage(ctx, user, accounts, pageNumber, editMessage) {
  const totalPages = Math.max(1, Math.ceil(accounts.length / ACCOUNTS_PAGE_SIZE));
  const page = Math.min(Math.max(Number(pageNumber) || 1, 1), totalPages);

  const text = buildAccountsPageText(user, accounts, page, totalPages);
  const replyMarkup = buildAccountsNav(user, page, totalPages);
  const options = replyMarkup ? { reply_markup: replyMarkup } : undefined;

  if (editMessage) {
    try {
      if (options) {
        return await ctx.editMessageText(text, options);
      }
      return await ctx.editMessageText(text);
    } catch (error) {
      logger.warn("Failed to edit account page message, sending new message", { error: error.message });
      if (options) {
        return ctx.reply(text, options);
      }
      return ctx.reply(text);
    }
  }

  if (options) {
    return ctx.reply(text, options);
  }
  return ctx.reply(text);
}

async function handleAccountsPageAction(ctx) {
  const user = await getOrCreateTelegramUser(ctx);
  const scope = await resolveSharedScope(user.telegramId, user._id);
  const accounts = await OutlookAccount.find({
    telegramUserId: { $in: scope.userIds },
    isActive: true,
  }).sort({ connectedAt: -1 });
  const requestedPage = Number(ctx.match?.[1] || 1);

  await ctx.answerCbQuery();

  if (accounts.length === 0) {
    return ctx.reply(textFor(user, "noAccounts"));
  }

  return renderAccountsPage(ctx, user, accounts, requestedPage, true);
}

async function handleCheck(ctx) {
  const user = await getOrCreateTelegramUser(ctx);
  try {
    const result = await checkForUser(user.telegramId);
    const message =
      `${textFor(user, "checkDone")}\n\n` +
      `${textFor(user, "checkAccounts")}: ${result.accounts}\n` +
      `${textFor(user, "checkScanned")}: ${result.checked}\n` +
      `${textFor(user, "checkSent")}: ${result.notified}`;
    return ctx.reply(message);
  } catch (error) {
    logger.error("Error in check handler", { error: error.message });
    return ctx.reply(textFor(user, "checkError"));
  }
}

async function handleCheckDebug(ctx) {
  const user = await getOrCreateTelegramUser(ctx);

  try {
    const result = await checkForUserWithOptions(user.telegramId, { debug: true });
    const header =
      `${textFor(user, "debugTitle")}\n\n` +
      `${textFor(user, "checkAccounts")}: ${result.accounts}\n` +
      `${textFor(user, "checkScanned")}: ${result.checked}\n` +
      `${textFor(user, "checkMatched")}: ${result.matched}\n` +
      `${textFor(user, "checkSent")}: ${result.notified}\n` +
      `${textFor(user, "checkDuplicates")}: ${result.duplicateSkipped}\n` +
      `${textFor(user, "checkNonMatching")}: ${result.nonMatchingSkipped}`;

    const previewEvents = Array.isArray(result.debugEvents) ? result.debugEvents.slice(0, 8) : [];
    if (previewEvents.length === 0) {
      return ctx.reply(`${header}\n\n${textFor(user, "debugNoEvents")}`);
    }

    const eventLines = previewEvents.map((evt, idx) => {
      const msgId = evt.messageId || "-";
      const reason = evt.reason || "unknown";
      const provider = evt.provider ? ` provider=${evt.provider}` : "";
      const code = evt.extractedCode ? ` code=${evt.extractedCode}` : "";
      return `${idx + 1}. id=${msgId} reason=${reason}${provider}${code}`;
    });

    return ctx.reply(`${header}\n\n${eventLines.join("\n")}`);
  } catch (error) {
    logger.error("Error in check debug handler", { error: error.message });
    return ctx.reply(textFor(user, "checkError"));
  }
}

async function handleHelp(ctx) {
  const user = await getOrCreateTelegramUser(ctx);
  return ctx.reply(textFor(user, "help"));
}

async function handleUnlinkHelp(ctx) {
  const user = await getOrCreateTelegramUser(ctx);
  const scope = await resolveSharedScope(user.telegramId, user._id);
  const accounts = await OutlookAccount.find({ telegramUserId: { $in: scope.userIds }, isActive: true }).sort({
    connectedAt: -1,
  });

  if (accounts.length === 0) {
    return ctx.reply(textFor(user, "unlinkNoAccounts"));
  }

  const lines = accounts.map((account, index) => `${index + 1}. ${account.email}`);
  return ctx.reply(`${textFor(user, "accountsTitle")}${lines.join("\n")}\n\n${textFor(user, "unlinkPrompt")}`);
}

async function handleUnlink(ctx) {
  const user = await getOrCreateTelegramUser(ctx);
  const raw = ctx.message?.text || "";
  const value = raw.replace(/^\/unlink(@\w+)?/i, "").trim();

  if (!value) {
    return handleUnlinkHelp(ctx);
  }

  const scope = await resolveSharedScope(user.telegramId, user._id);
  const accounts = await OutlookAccount.find({ telegramUserId: { $in: scope.userIds }, isActive: true }).sort({
    connectedAt: -1,
  });
  if (accounts.length === 0) {
    return ctx.reply(textFor(user, "unlinkNoAccounts"));
  }

  let target = null;
  if (/^\d+$/.test(value)) {
    const idx = Number(value) - 1;
    if (idx >= 0 && idx < accounts.length) {
      target = accounts[idx];
    }
  } else {
    target = accounts.find((acc) => acc.email.toLowerCase() === value.toLowerCase());
  }

  if (!target) {
    return ctx.reply(textFor(user, "unlinkNotFound"));
  }

  target.isActive = false;
  await target.save();
  return ctx.reply(`${textFor(user, "unlinkDone")}\n${target.email}`);
}

async function handleLanguageToggle(ctx) {
  const user = await getOrCreateTelegramUser(ctx);
  user.preferredLanguage = user.preferredLanguage === "en" ? "ar" : "en";
  await user.save();

  if (user.preferredLanguage === "ar") {
    await ctx.reply(TEXT.ar.switchedToArabic);
  } else {
    await ctx.reply(TEXT.en.switchedToEnglish);
  }

  return showMainMenu(ctx, user);
}

function safeExecute(handler) {
  return async (ctx) => {
    try {
      await handler(ctx);
    } catch (error) {
      logger.error("Telegram handler error", {
        handler: handler.name,
        error: error.message,
      });

      try {
        const user = await getOrCreateTelegramUser(ctx);
        await ctx.reply(textFor(user, "genericError"));
      } catch (replyError) {
        logger.error("Failed to send safe error reply", { error: replyError.message });
      }
    }
  };
}

function registerTelegramCommands(bot) {
  bot.catch(async (error, ctx) => {
    logger.error("Unhandled Telegraf error", {
      error: error.message,
      updateType: ctx?.updateType,
    });

    try {
      if (ctx) {
        const user = await getOrCreateTelegramUser(ctx);
        await ctx.reply(textFor(user, "genericError"));
      }
    } catch (nestedError) {
      logger.error("Failed while handling bot.catch error", { error: nestedError.message });
    }
  });

  bot.start(safeExecute(handleStart));

  bot.hears([LABELS.ar.connect, LABELS.en.connect], safeExecute(handleConnect));
  bot.hears([LABELS.ar.accounts, LABELS.en.accounts], safeExecute(handleAccounts));
  bot.hears([LABELS.ar.checkNow, LABELS.en.checkNow], safeExecute(handleCheck));
  bot.hears([LABELS.ar.help, LABELS.en.help], safeExecute(handleHelp));
  bot.hears([LABELS.ar.language, LABELS.en.language], safeExecute(handleLanguageToggle));
  bot.hears([LABELS.ar.unlink, LABELS.en.unlink], safeExecute(handleUnlinkHelp));

  bot.command("start", safeExecute(handleStart));
  bot.command("connect", safeExecute(handleConnect));
  bot.command("accounts", safeExecute(handleAccounts));
  bot.command("check", safeExecute(handleCheck));
  bot.command("checkdebug", safeExecute(handleCheckDebug));
  bot.command("help", safeExecute(handleHelp));
  bot.command("lang", safeExecute(handleLanguageToggle));
  bot.command("unlink", safeExecute(handleUnlink));
  bot.action(/^accounts:page:(\d+)$/, safeExecute(handleAccountsPageAction));

  return bot;
}

module.exports = {
  registerTelegramCommands,
  showMainMenu,
};
