const fs = require("fs");
const os = require("os");
const path = require("path");

const OutlookAccount = require("../models/OutlookAccount");
const { getInboxMessagesBySender, getFullMessageBody } = require("./outlookService");
const { asyncPool } = require("../utils/asyncPool");
const logger = require("../utils/logger").withContext("TicketReportService");
const { runtimeConfig } = require("../config/runtime");

const TICKET_SENDERS = ["noreply@ahlan.sa", "amr43103@gmail.com"];
const EMAIL_QUERY_CHUNK_SIZE = 200;

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function normalizeEmail(input) {
  return String(input || "")
    .trim()
    .toLowerCase();
}

function sortAccountsByConnectedAt(accounts) {
  return accounts
    .slice()
    .sort((a, b) => new Date(b?.connectedAt || 0).getTime() - new Date(a?.connectedAt || 0).getTime());
}

function dedupeAccountsByEmail(accounts) {
  const byEmail = new Map();

  for (const account of sortAccountsByConnectedAt(accounts)) {
    const email = normalizeEmail(account?.email);
    const key = email || String(account?._id || "");
    if (!key || byEmail.has(key)) {
      continue;
    }
    byEmail.set(key, account);
  }

  return Array.from(byEmail.values());
}

async function findActiveAccountsByRequestedEmails(requestedEmails) {
  if (!Array.isArray(requestedEmails) || requestedEmails.length === 0) {
    const allActiveAccounts = await OutlookAccount.find({ isActive: true }).sort({ connectedAt: -1 });
    return dedupeAccountsByEmail(allActiveAccounts);
  }

  const normalizedRequestedEmails = [...new Set(requestedEmails.map((value) => normalizeEmail(value)).filter(Boolean))];
  const chunks = chunkArray(normalizedRequestedEmails, EMAIL_QUERY_CHUNK_SIZE);
  const byEmail = new Map();

  for (const chunk of chunks) {
    const partial = await OutlookAccount.find({
      isActive: true,
      email: { $in: chunk },
    }).sort({ connectedAt: -1 });

    for (const account of sortAccountsByConnectedAt(partial)) {
      const email = normalizeEmail(account?.email);
      const key = email || String(account?._id || "");
      if (!key || byEmail.has(key)) {
        continue;
      }
      byEmail.set(key, account);
    }
  }

  return sortAccountsByConnectedAt(Array.from(byEmail.values()));
}

function getXlsxLibrary() {
  try {
    return require("xlsx");
  } catch (error) {
    if (error?.code === "MODULE_NOT_FOUND") {
      throw new Error("xlsx package is missing. Run npm install in the project directory.");
    }
    throw error;
  }
}

function stripHtml(input) {
  return String(input || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\u200f|\u200e/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeForMatch(input) {
  return String(input || "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitMeaningfulLines(input) {
  return String(input || "")
    .split(/\r?\n/)
    .map((line) => normalizeForMatch(line))
    .filter(Boolean);
}

function stripTrailingAmount(input) {
  return String(input || "")
    .replace(/\s+\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,6})\s*$/, "")
    .trim();
}

function stripEventTail(input) {
  return String(input || "")
    .replace(
      /\s+(?:ضريبة\s*القيمة\s*المضافة|الإجمالي|معلومات\s*التذاكر|تفاصيل\s*الدفع|discount|vat|total|tickets?\s+information|fan\s+guide\s+available!?|view\s+guide|download\s+the\s+app|need\s+help\??|privacy\s+policy|terms\s*&?\s*conditions)[\s\S]*$/i,
      "",
    )
    .replace(
      /\s+\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,6})\s+(?:ضريبة\s*القيمة\s*المضافة|الإجمالي|معلومات\s*التذاكر|discount|vat|total|tickets?\s+information)[\s\S]*$/i,
      "",
    )
    .replace(/\s+\{?\d{1,2}\/\d{1,2}\/\d{4}[\s\S]*$/i, "")
    .replace(/\s+مدينة\s+[^{}]+$/i, "")
    .trim();
}

function cleanupEventName(input) {
  return stripTrailingAmount(
    stripEventTail(
      stripTrailingAmount(
        String(input || "")
          .replace(/^Event\s*[:\-]?\s*/i, "")
          .replace(/^(?:تذاكر\s*لـ?|Tickets?\s+for)\s*/i, "")
          .trim(),
      ),
    ),
  );
}

function parseEventName(text, fallbackSubject) {
  const source = String(text || "");
  const normalized = normalizeForMatch(source);

  const byPurchase = normalized.match(
    /(?:^|\s)(?:تذاكر\s*لـ?|Tickets?\s+for)\s*(.+?)(?=\s+\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,6})\b|\s*ضريبة\s*القيمة\s*المضافة|\s*الإجمالي|\s*معلومات\s*التذاكر|\s*discount\b|\s*vat\b|\s*total\b|\s*tickets?\s+information\b|$)/i,
  );
  if (byPurchase && byPurchase[1]) {
    const cleaned = cleanupEventName(byPurchase[1]);
    if (cleaned) {
      return cleaned;
    }
  }

  const eventBlock = source.match(/(?:^|\n)\s*Event\s*[:\-]?\s*([\s\S]+?)(?:\n\s*View on Map|\n\s*تفاصيل الدفع|$)/i);
  if (eventBlock && eventBlock[1]) {
    const eventLines = splitMeaningfulLines(eventBlock[1]);
    for (const line of eventLines) {
      const cleaned = cleanupEventName(line);
      if (cleaned) {
        return cleaned;
      }
    }
  }

  const normalizedEventBlock = normalized.match(/Event\s*[:\-]?\s*(.+?)(?=\s*View on Map|\s*تفاصيل\s*الدفع|$)/i);
  if (normalizedEventBlock && normalizedEventBlock[1]) {
    const cleaned = cleanupEventName(normalizedEventBlock[1]);
    if (cleaned) {
      return cleaned;
    }
  }

  const byEnglishTotals = normalized.match(
    /^(.+?)(?=\s+\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,6})\s+(?:discount|vat|total)\b|\s*tickets?\s+information\b|\s*fan\s+guide\s+available!?|$)/i,
  );
  if (byEnglishTotals && byEnglishTotals[1]) {
    const cleaned = cleanupEventName(byEnglishTotals[1]);
    if (cleaned && !/^(success|order|payment|ticket|tickets information)\b/i.test(cleaned)) {
      return cleaned;
    }
  }

  return cleanupEventName(fallbackSubject) || "Unknown Event";
}

function parseEventDate(text, receivedDateTime) {
  const normalized = normalizeForMatch(text);
  const direct = normalized.match(/\{?\s*(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2}\s*[AP]M)\s*\}?/i);
  if (direct && direct[1]) {
    return direct[1].trim();
  }

  const arDate = normalized.match(/التاريخ\s*والساعة\s*[:\-]?\s*([0-9\-: ]+)/i);
  if (arDate && arDate[1]) {
    return arDate[1].trim();
  }

  return receivedDateTime ? new Date(receivedDateTime).toISOString() : "";
}

function parseOperationNumber(text) {
  const normalized = normalizeForMatch(text);
  const match = normalized.match(/رقم\s*العملية\s*[:\-]?\s*([A-Z0-9]+)/i);
  if (match && match[1]) {
    return match[1].trim();
  }
  return "";
}

function parseTicketLines(text) {
  const source = String(text || "");
  const pattern = /(تذكرة|Ticket)\s*\d+\s*(قسم|Section)\s*([^\s]+)\s*(صف|Row)\s*([^\s]+)\s*(مقعد|Seat)\s*([^\s\|]+)/giu;

  const rows = [];
  const seen = new Set();
  let match = pattern.exec(source);
  while (match) {
    const section = String(match[3] || "").trim();
    const row = String(match[5] || "").trim();
    const seatRaw = String(match[7] || "").trim();
    const seatNumber = Number.parseInt(seatRaw.replace(/[^0-9]/g, ""), 10);
    const key = `${section}::${row}::${seatRaw}`;

    if (!seen.has(key)) {
      seen.add(key);
      rows.push({
        section,
        row,
        seat: seatRaw,
        seatNumber: Number.isNaN(seatNumber) ? null : seatNumber,
      });
    }

    match = pattern.exec(source);
  }

  return rows;
}

async function fetchTicketMessagesForFolder(account, sender, folderName) {
  try {
    return await getInboxMessagesBySender(account, sender, {
      pageSize: runtimeConfig.ticketReportPageSize,
      maxPages: runtimeConfig.ticketReportMaxPages,
      folderName,
    });
  } catch (error) {
    logger.warn("Failed fetching ticket messages for folder", {
      accountId: String(account._id),
      email: account.email,
      sender,
      folderName,
      error: error.message,
    });
    return [];
  }
}

async function collectTicketRowsFromAccount(account) {
  const rows = [];
  const messageGroups = await Promise.all(
    TICKET_SENDERS.flatMap((sender) => [
      fetchTicketMessagesForFolder(account, sender, "inbox"),
      fetchTicketMessagesForFolder(account, sender, "junkemail"),
    ]),
  );

  const uniqueById = new Map();
  for (const message of messageGroups.flat()) {
    if (!message?.id) {
      continue;
    }
    uniqueById.set(message.id, message);
  }

  const messages = Array.from(uniqueById.values());

  for (const message of messages) {
    try {
      const full = await getFullMessageBody(account, message.id);
      const body = stripHtml(full.bodyText || message.bodyPreview || "");

      if (!/معلومات\s*التذاكر|تذكرة\s*\d+|Ticket\s*\d+/i.test(body)) {
        continue;
      }

      const eventName = parseEventName(body, message.subject);
      const eventDate = parseEventDate(body, message.receivedDateTime);
      const operationNumber = parseOperationNumber(body);
      const ticketLines = parseTicketLines(body);

      for (const ticket of ticketLines) {
        rows.push({
          eventName,
          eventDate,
          section: ticket.section,
          row: ticket.row,
          seat: ticket.seat,
          seatNumber: ticket.seatNumber,
          accountEmail: account.email,
          operationNumber,
          subject: message.subject || "",
          receivedAt: message.receivedDateTime || "",
          messageId: message.id,
        });
      }
    } catch (error) {
      logger.warn("Failed parsing ticket email", {
        accountId: String(account._id),
        messageId: message.id,
        error: error.message,
      });
    }
  }

  return rows;
}

function keyForTicket(ticket) {
  return `${ticket.messageId}::${ticket.eventName}::${ticket.section}::${ticket.row}::${ticket.seat}`;
}

function keyForUniqueTicket(ticket) {
  return [
    normalizeForMatch(ticket.accountEmail),
    normalizeForMatch(ticket.eventName),
    normalizeForMatch(ticket.eventDate),
    normalizeForMatch(ticket.section),
    normalizeForMatch(ticket.row),
    normalizeForMatch(ticket.seat),
  ].join("::");
}

function dedupeTickets(tickets) {
  const unique = [];
  const seen = new Set();

  for (const ticket of tickets) {
    const key = keyForUniqueTicket(ticket);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(ticket);
  }

  return unique;
}

function buildAdjacentSeatEntries(tickets) {
  const seats = new Map();

  for (const ticket of tickets) {
    const key = String(ticket.seatNumber);
    if (!seats.has(key)) {
      seats.set(key, {
        seatNumber: ticket.seatNumber,
        seat: ticket.seat,
        sourceTickets: [],
      });
    }

    seats.get(key).sourceTickets.push(ticket);
  }

  return Array.from(seats.values())
    .sort((a, b) => a.seatNumber - b.seatNumber)
    .map((seatEntry) => {
      const accounts = Array.from(
        new Set(
          seatEntry.sourceTickets
            .map((ticket) => normalizeForMatch(ticket.accountEmail))
            .filter(Boolean),
        ),
      );

      return {
        seatNumber: seatEntry.seatNumber,
        seat: seatEntry.seat,
        sourceTickets: seatEntry.sourceTickets,
        accountLabels: accounts.map((email) => `${seatEntry.seat}: ${email}`),
      };
    });
}

function appendAdjacentGroup(adjacentGroups, adjacentKeys, eventName, section, row, run) {
  if (run.length < 2) {
    return;
  }

  const fromSeat = run[0].seatNumber;
  const toSeat = run[run.length - 1].seatNumber;
  const accounts = run.flatMap((item) => item.accountLabels).join(" | ");

  adjacentGroups.push({
    eventName,
    section,
    row,
    adjacentSeats: `${fromSeat}-${toSeat}`,
    from: fromSeat,
    to: toSeat,
    count: run.length,
    accounts,
  });

  for (const item of run) {
    for (const ticket of item.sourceTickets) {
      adjacentKeys.add(keyForTicket(ticket));
    }
  }
}

function buildAdjacentGroups(allTickets) {
  const grouped = new Map();

  for (const ticket of allTickets) {
    if (ticket.seatNumber === null) {
      continue;
    }
    const key = `${ticket.eventName}||${ticket.section}||${ticket.row}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(ticket);
  }

  const adjacentGroups = [];
  const adjacentKeys = new Set();

  for (const [key, tickets] of grouped.entries()) {
    const [eventName, section, row] = key.split("||");
    const sorted = buildAdjacentSeatEntries(tickets);
    if (sorted.length < 2) {
      continue;
    }

    let run = [sorted[0]];
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1];
      const curr = sorted[i];

      if (curr.seatNumber === prev.seatNumber + 1) {
        run.push(curr);
      } else {
        appendAdjacentGroup(adjacentGroups, adjacentKeys, eventName, section, row, run);
        run = [curr];
      }
    }

    appendAdjacentGroup(adjacentGroups, adjacentKeys, eventName, section, row, run);
  }

  return { adjacentGroups, adjacentKeys };
}

function toRawSheetRows(tickets) {
  return tickets.map((ticket) => ({
    الفعالية: ticket.eventName,
    تاريخ_الفعالية: ticket.eventDate,
    القسم: ticket.section,
    الصف: ticket.row,
    رقم_المقعد: ticket.seat,
    الحساب: ticket.accountEmail,
    رقم_العملية: ticket.operationNumber,
    وقت_الاستلام: ticket.receivedAt,
  }));
}

function toAdjacentSheetRows(adjacentGroups) {
  return adjacentGroups.map((group) => ({
    الفعالية: group.eventName,
    القسم: group.section,
    الصف: group.row,
    المقاعد_المتجاورة: group.adjacentSeats,
    من: group.from,
    الى: group.to,
    العدد: group.count,
    الحسابات: group.accounts,
  }));
}

function buildSheetColumns(rows) {
  const headers = Object.keys(rows[0] || {});
  const minWidths = {
    الفعالية: 60,
    تاريخ_الفعالية: 22,
    القسم: 12,
    الصف: 12,
    رقم_المقعد: 14,
    الحساب: 34,
    رقم_العملية: 22,
    وقت_الاستلام: 22,
    المقاعد_المتجاورة: 18,
    الحسابات: 42,
    ملاحظة: 28,
  };
  const maxWidths = {
    الفعالية: 76,
    الحساب: 40,
    رقم_العملية: 24,
    وقت_الاستلام: 24,
    الحسابات: 56,
    ملاحظة: 40,
  };

  return headers.map((header) => {
    const widestValue = rows.reduce((max, row) => {
      const valueLength = String(row?.[header] ?? "").length;
      return Math.max(max, valueLength);
    }, String(header).length);
    const minWidth = minWidths[header] || 12;
    const maxWidth = maxWidths[header] || 28;
    return {
      wch: Math.max(minWidth, Math.min(widestValue + 2, maxWidth)),
    };
  });
}

function applySheetLayout(sheet, rows) {
  const totalRows = rows.length + 1;
  sheet["!cols"] = buildSheetColumns(rows);
  sheet["!rows"] = Array.from({ length: totalRows }, (_unused, index) => ({
    hpt: index === 0 ? 20 : 20,
  }));

  if (sheet["!ref"]) {
    sheet["!autofilter"] = { ref: sheet["!ref"] };
  }
}

function writeSingleSheetWorkbook(filePath, rows, sheetName) {
  const XLSX = getXlsxLibrary();
  const workbook = XLSX.utils.book_new();
  const safeRows = rows.length > 0 ? rows : [{ ملاحظة: "لا توجد بيانات" }];
  const sheet = XLSX.utils.json_to_sheet(safeRows);
  applySheetLayout(sheet, safeRows);
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  XLSX.writeFile(workbook, filePath);
}

async function emitTicketReportProgress(progressHandler, payload) {
  if (typeof progressHandler !== "function") {
    return;
  }

  try {
    await progressHandler(payload);
  } catch (error) {
    logger.warn("Ticket report progress callback failed", { error: error.message });
  }
}

async function generateTicketReports(options = {}) {
  const requestedEmails = Array.isArray(options.accountEmails)
    ? options.accountEmails
        .map((value) =>
          String(value || "")
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean)
    : [];

  logger.info("Ticket report scan started", {
    requestedCount: requestedEmails.length,
    requestedEmails,
    accountConcurrency: runtimeConfig.ticketReportAccountConcurrency,
  });

  const accounts = await findActiveAccountsByRequestedEmails(requestedEmails);
  await emitTicketReportProgress(options.onProgress, {
    processedAccounts: 0,
    totalAccounts: accounts.length,
    requestedCount: requestedEmails.length,
  });

  let processedAccounts = 0;
  const collectedTicketGroups = await asyncPool(
    accounts,
    runtimeConfig.ticketReportAccountConcurrency,
    async (account) => {
      try {
        return await collectTicketRowsFromAccount(account);
      } catch (error) {
        logger.warn("Ticket scan failed for account", {
          accountId: String(account._id),
          email: account.email,
          error: error.message,
        });
        return [];
      } finally {
        processedAccounts += 1;
        await emitTicketReportProgress(options.onProgress, {
          processedAccounts,
          totalAccounts: accounts.length,
          requestedCount: requestedEmails.length,
          currentEmail: account.email,
        });
      }
    },
  );

  const collectedTickets = collectedTicketGroups.flat();

  const allTickets = dedupeTickets(collectedTickets);
  const duplicateTicketsRemoved = collectedTickets.length - allTickets.length;
  const { adjacentGroups, adjacentKeys } = buildAdjacentGroups(allTickets);
  const nonAdjacentTickets = allTickets.filter((ticket) => !adjacentKeys.has(keyForTicket(ticket)));
  const files = [];

  if (allTickets.length > 0) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dir = path.join(os.tmpdir(), `ticket-reports-${stamp}`);
    fs.mkdirSync(dir, { recursive: true });

    const allTicketsPath = path.join(dir, "01_all_tickets.xlsx");
    const adjacentPath = path.join(dir, "02_adjacent_tickets.xlsx");
    const nonAdjacentPath = path.join(dir, "03_non_adjacent_tickets.xlsx");

    writeSingleSheetWorkbook(allTicketsPath, toRawSheetRows(allTickets), "All Tickets");
    writeSingleSheetWorkbook(adjacentPath, toAdjacentSheetRows(adjacentGroups), "Adjacent");
    writeSingleSheetWorkbook(nonAdjacentPath, toRawSheetRows(nonAdjacentTickets), "Non Adjacent");

    files.push(allTicketsPath, adjacentPath, nonAdjacentPath);
  }

  logger.info("Ticket report scan completed", {
    requestedCount: requestedEmails.length,
    accountsScanned: accounts.length,
    duplicateTicketsRemoved,
    totalTickets: allTickets.length,
    adjacentGroups: adjacentGroups.length,
    nonAdjacentTickets: nonAdjacentTickets.length,
  });

  return {
    senders: TICKET_SENDERS,
    requestedEmails,
    requestedCount: requestedEmails.length,
    matchedAccounts: accounts.map((account) => account.email),
    accountsScanned: accounts.length,
    totalTickets: allTickets.length,
    adjacentGroups: adjacentGroups.length,
    nonAdjacentTickets: nonAdjacentTickets.length,
    files,
  };
}

module.exports = {
  generateTicketReports,
};
