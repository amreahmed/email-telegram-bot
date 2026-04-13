function parseBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "yes" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "no" || normalized === "0") {
    return false;
  }
  return undefined;
}

function parseRuleInput(raw) {
  const result = {};
  if (!raw) {
    return result;
  }

  const pairs = raw
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);

  for (const pair of pairs) {
    const [key, ...rest] = pair.split("=");
    if (!key || rest.length === 0) {
      continue;
    }
    const value = rest.join("=").trim();
    const normalizedKey = key.trim().toLowerCase();

    if (normalizedKey === "sender") {
      result.senderContains = value;
    } else if (normalizedKey === "subject") {
      result.subjectContains = value;
    } else if (normalizedKey === "attachment") {
      const parsed = parseBoolean(value);
      if (typeof parsed === "boolean") {
        result.hasAttachment = parsed;
      }
    } else if (normalizedKey === "account") {
      result.accountEmail = value.toLowerCase();
    }
  }

  return result;
}

function matchesRule(message, rule) {
  if (!rule.isActive) {
    return false;
  }

  const sender = (message.from?.emailAddress?.address || "").toLowerCase();
  const subject = (message.subject || "").toLowerCase();

  if (rule.senderContains && !sender.includes(rule.senderContains.toLowerCase())) {
    return false;
  }

  if (rule.subjectContains && !subject.includes(rule.subjectContains.toLowerCase())) {
    return false;
  }

  if (typeof rule.hasAttachment === "boolean" && message.hasAttachments !== rule.hasAttachment) {
    return false;
  }

  return true;
}

function safePreview(text, maxLength = 160) {
  if (!text) {
    return "-";
  }
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, maxLength - 3)}...`;
}

module.exports = {
  parseRuleInput,
  matchesRule,
  safePreview,
};
