#!/usr/bin/env node

const { matchProvider } = require("../src/services/providerEngine");
const { extractCode } = require("../src/services/codeExtractionService");
const { buildOtpNotification } = require("../src/services/notificationTemplates");
const { asyncPool } = require("../src/utils/asyncPool");

function parseArg(name, fallback) {
  const arg = process.argv.find((item) => item.startsWith(`--${name}=`));
  if (!arg) {
    return fallback;
  }
  const value = arg.split("=")[1];
  return value === undefined || value === "" ? fallback : value;
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function randomChoice(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function randomDigits(length) {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += String(Math.floor(Math.random() * 10));
  }
  return out;
}

function buildMatchingMessage(accountIndex, messageIndex) {
  const code = randomDigits(randomChoice([4, 5, 6, 7]));
  const sender = randomChoice([
    "noreply@webook.com",
    "login@auth.webook.com",
    "support@mail.webook.com",
    "alerts@security.auth.webook.com",
  ]);

  const subject = randomChoice([
    `${code} is your webook verification code`,
    `Your webook code is ${code}`,
    `رمز التحقق الخاص بك هو ${code}`,
    `Verification code: ${code}`,
  ]);

  const bodyPreview = randomChoice([
    `Use ${code} to verify your account. This code expires in 5 minutes.`,
    `رمز التحقق هو ${code} ويصبح غير صالح بعد 5 دقائق.`,
    `Webook login code: ${code}`,
    `Please confirm your sign-in with code ${code}`,
  ]);

  return {
    id: `acc-${accountIndex}-msg-${messageIndex}`,
    from: { emailAddress: { address: sender } },
    subject,
    bodyPreview,
    receivedDateTime: new Date(Date.now() - messageIndex * 1000).toISOString(),
  };
}

function buildNonMatchingMessage(accountIndex, messageIndex) {
  const sender = randomChoice(["noreply@fakewebook.com", "promo@shop.com", "alerts@webook.co", "newsletter@random.io"]);

  const subject = randomChoice(["Weekly newsletter", "Order shipped", "Your receipt", "Welcome to our service"]);

  const bodyPreview = randomChoice([
    "Thanks for joining.",
    "Your package is on the way.",
    "Read this update.",
    "See your latest dashboard activity.",
  ]);

  return {
    id: `acc-${accountIndex}-msg-${messageIndex}`,
    from: { emailAddress: { address: sender } },
    subject,
    bodyPreview,
    receivedDateTime: new Date(Date.now() - messageIndex * 1000).toISOString(),
  };
}

function generateAccountMessages(accountIndex, messagesPerAccount, matchingRatio) {
  const messages = [];
  const matchingCount = Math.floor(messagesPerAccount * matchingRatio);

  for (let i = 1; i <= messagesPerAccount; i += 1) {
    if (i <= matchingCount) {
      messages.push(buildMatchingMessage(accountIndex, i));
    } else {
      messages.push(buildNonMatchingMessage(accountIndex, i));
    }
  }

  if (messages.length >= 10) {
    messages.push({ ...messages[2], id: messages[2].id });
  }

  return messages;
}

async function processSyntheticAccount(account, options) {
  const dedupe = new Set();
  let matched = 0;
  let notMatched = 0;
  let duplicateSkipped = 0;
  let extracted = 0;

  for (const message of account.messages) {
    if (dedupe.has(message.id)) {
      duplicateSkipped += 1;
      continue;
    }
    dedupe.add(message.id);

    const providerDecision = matchProvider(message);
    if (!providerDecision.matched) {
      notMatched += 1;
      continue;
    }

    matched += 1;
    const extraction = extractCode(message, {
      providerCodeRegex: providerDecision.provider?.codeRegex,
    });

    if (!extraction.code) {
      continue;
    }

    extracted += 1;

    if (options.captureSamples && options.samples.length < 3) {
      options.samples.push(
        buildOtpNotification({
          language: options.language,
          provider: providerDecision.provider,
          code: extraction.code,
          accountEmail: account.email,
        }),
      );
    }
  }

  return {
    accountId: account.id,
    matched,
    notMatched,
    duplicateSkipped,
    extracted,
    totalUnique: dedupe.size,
  };
}

async function runSimulation({ accountsCount, messagesPerAccount, matchingRatio, language, concurrency }) {
  const accounts = Array.from({ length: accountsCount }, (_, i) => ({
    id: i + 1,
    email: `user${i + 1}@outlook.com`,
    messages: generateAccountMessages(i + 1, messagesPerAccount, matchingRatio),
  }));

  const startedAt = Date.now();
  const samples = [];

  const results = await asyncPool(accounts, concurrency, (account) =>
    processSyntheticAccount(account, {
      language,
      captureSamples: true,
      samples,
    }),
  );

  const totals = results.reduce(
    (acc, item) => {
      acc.matched += item.matched;
      acc.notMatched += item.notMatched;
      acc.duplicateSkipped += item.duplicateSkipped;
      acc.extracted += item.extracted;
      acc.totalUnique += item.totalUnique;
      return acc;
    },
    {
      matched: 0,
      notMatched: 0,
      duplicateSkipped: 0,
      extracted: 0,
      totalUnique: 0,
    },
  );

  const totalInput = accounts.reduce((sum, account) => sum + account.messages.length, 0);
  const durationMs = Date.now() - startedAt;

  return {
    accountsCount,
    messagesPerAccount,
    concurrency,
    totalInput,
    totalUnique: totals.totalUnique,
    matched: totals.matched,
    notMatched: totals.notMatched,
    duplicateSkipped: totals.duplicateSkipped,
    extracted: totals.extracted,
    durationMs,
    throughputMsgsPerSec: ((totals.totalUnique / Math.max(durationMs, 1)) * 1000).toFixed(2),
    samples,
  };
}

function printReport(report) {
  console.log(`\n=== ${report.accountsCount} Accounts Scale Simulation ===`);
  console.log(`Accounts simulated:        ${report.accountsCount}`);
  console.log(`Messages/account:          ${report.messagesPerAccount}`);
  console.log(`Concurrency:               ${report.concurrency}`);
  console.log(`Total input messages:      ${report.totalInput}`);
  console.log(`Unique message IDs:        ${report.totalUnique}`);
  console.log(`Matched provider rules:    ${report.matched}`);
  console.log(`Not matched:               ${report.notMatched}`);
  console.log(`Duplicate skipped:         ${report.duplicateSkipped}`);
  console.log(`Codes extracted:           ${report.extracted}`);
  console.log(`Duration (ms):             ${report.durationMs}`);
  console.log(`Throughput (msg/sec):      ${report.throughputMsgsPerSec}`);

  console.log("\n=== Sample Notifications ===");
  report.samples.forEach((item, index) => {
    console.log(`\n#${index + 1}`);
    console.log(item);
  });
  console.log(
    `\nDone. This validates matching/extraction behavior at ${report.accountsCount}-account scale without requiring real ${report.accountsCount} mailboxes.\n`,
  );
}

async function main() {
  const accountsCount = toInt(parseArg("accounts", "1000"), 1000);
  const messagesPerAccount = toInt(parseArg("messagesPerAccount", "15"), 15);
  const concurrency = Math.max(1, toInt(parseArg("concurrency", "10"), 10));
  const language = parseArg("lang", "ar") === "en" ? "en" : "ar";
  const matchingRatioRaw = Number.parseFloat(parseArg("matchingRatio", "0.7"));
  const matchingRatio = Number.isNaN(matchingRatioRaw) ? 0.7 : Math.min(Math.max(matchingRatioRaw, 0), 1);

  const report = await runSimulation({
    accountsCount,
    messagesPerAccount,
    matchingRatio,
    language,
    concurrency,
  });

  printReport(report);
}

main().catch((error) => {
  console.error("Simulation failed", error);
  process.exit(1);
});
