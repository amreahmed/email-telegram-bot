#!/usr/bin/env node

const { matchProvider } = require("../src/services/providerEngine");
const { extractCode } = require("../src/services/codeExtractionService");
const { buildOtpNotification } = require("../src/services/notificationTemplates");

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

function buildMatchingMessage(index) {
  const code = randomDigits(randomChoice([4, 5, 6]));
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
    id: `msg-${index}`,
    from: { emailAddress: { address: sender } },
    subject,
    bodyPreview,
    receivedDateTime: new Date(Date.now() - index * 1000).toISOString(),
    _expectedCode: code,
    _isExpectedMatch: true,
  };
}

function buildNonMatchingMessage(index) {
  const sender = randomChoice(["noreply@fakewebook.com", "promo@shop.com", "alerts@webook.co", "newsletter@random.io"]);

  const subject = randomChoice(["Weekly newsletter", "Order shipped", "Your receipt", "Welcome to our service"]);

  const bodyPreview = randomChoice([
    "Thanks for joining.",
    "Your package is on the way.",
    "Read this update.",
    "See your latest dashboard activity.",
  ]);

  return {
    id: `msg-${index}`,
    from: { emailAddress: { address: sender } },
    subject,
    bodyPreview,
    receivedDateTime: new Date(Date.now() - index * 1000).toISOString(),
    _expectedCode: null,
    _isExpectedMatch: false,
  };
}

function generateMessages(total, matchingRatio) {
  const messages = [];
  const matchingCount = Math.floor(total * matchingRatio);

  for (let i = 1; i <= total; i += 1) {
    if (i <= matchingCount) {
      messages.push(buildMatchingMessage(i));
    } else {
      messages.push(buildNonMatchingMessage(i));
    }
  }

  // Add some duplicates intentionally for dedupe simulation checks.
  if (total >= 20) {
    messages.push({ ...messages[5], id: messages[5].id });
    messages.push({ ...messages[10], id: messages[10].id });
  }

  return messages;
}

function runSimulation({ total, matchingRatio, language }) {
  const messages = generateMessages(total, matchingRatio);

  const dedupeSet = new Set();
  let matched = 0;
  let notMatched = 0;
  let duplicateSkipped = 0;
  let extracted = 0;
  let extractionFailed = 0;
  let expectedMatched = 0;
  let expectedNotMatched = 0;
  let falsePositive = 0;
  let falseNegative = 0;

  const sampleNotifications = [];

  for (const message of messages) {
    if (dedupeSet.has(message.id)) {
      duplicateSkipped += 1;
      continue;
    }
    dedupeSet.add(message.id);

    const providerDecision = matchProvider(message);
    const isMatched = providerDecision.matched;

    if (message._isExpectedMatch) {
      expectedMatched += 1;
      if (!isMatched) {
        falseNegative += 1;
      }
    } else {
      expectedNotMatched += 1;
      if (isMatched) {
        falsePositive += 1;
      }
    }

    if (!isMatched) {
      notMatched += 1;
      continue;
    }

    matched += 1;

    const extraction = extractCode(message, {
      providerCodeRegex: providerDecision.provider?.codeRegex,
    });

    if (!extraction.code) {
      extractionFailed += 1;
      continue;
    }

    extracted += 1;

    if (sampleNotifications.length < 5) {
      sampleNotifications.push(
        buildOtpNotification({
          language,
          provider: providerDecision.provider,
          code: extraction.code,
          accountEmail: "test-account@outlook.com",
        }),
      );
    }
  }

  return {
    totalInput: messages.length,
    totalUnique: dedupeSet.size,
    matched,
    notMatched,
    duplicateSkipped,
    extracted,
    extractionFailed,
    expectedMatched,
    expectedNotMatched,
    falsePositive,
    falseNegative,
    sampleNotifications,
  };
}

function printReport(report) {
  console.log("\n=== OTP Load Simulation Report ===");
  console.log(`Total input messages:      ${report.totalInput}`);
  console.log(`Unique message IDs:        ${report.totalUnique}`);
  console.log(`Matched provider rules:    ${report.matched}`);
  console.log(`Not matched:               ${report.notMatched}`);
  console.log(`Duplicate skipped:         ${report.duplicateSkipped}`);
  console.log(`Codes extracted:           ${report.extracted}`);
  console.log(`Extraction failed:         ${report.extractionFailed}`);
  console.log(`Expected match count:      ${report.expectedMatched}`);
  console.log(`Expected non-match count:  ${report.expectedNotMatched}`);
  console.log(`False positives:           ${report.falsePositive}`);
  console.log(`False negatives:           ${report.falseNegative}`);

  console.log("\n=== Sample Notifications ===");
  if (report.sampleNotifications.length === 0) {
    console.log("No notifications generated.");
  } else {
    report.sampleNotifications.forEach((item, index) => {
      console.log(`\n#${index + 1}`);
      console.log(item);
    });
  }

  console.log(
    "\nDone. This simulation validates provider matching and OTP extraction at scale without real 500 emails.\n",
  );
}

function main() {
  const total = toInt(parseArg("count", "500"), 500);
  const matchingRatioRaw = Number.parseFloat(parseArg("matchingRatio", "0.7"));
  const matchingRatio = Number.isNaN(matchingRatioRaw) ? 0.7 : Math.min(Math.max(matchingRatioRaw, 0), 1);
  const language = parseArg("lang", "ar") === "en" ? "en" : "ar";

  const report = runSimulation({ total, matchingRatio, language });
  printReport(report);
}

main();
