function stripHtmlTags(input) {
  return String(input || "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildContentParts(message, fullBodyText) {
  const subject = String(message?.subject || "");
  const preview = String(message?.bodyPreview || "");
  const full = String(fullBodyText || "");
  return {
    subject,
    preview,
    full,
    combined: [subject, preview, full].filter(Boolean).join("\n"),
  };
}

function cleanCode(value) {
  return String(value || "")
    .replace(/[^A-Za-z0-9]/g, "")
    .trim();
}

function applyRegex(content, regexLike) {
  if (!regexLike) {
    return null;
  }

  try {
    const regex = regexLike instanceof RegExp ? regexLike : new RegExp(regexLike, "i");
    const match = String(content || "").match(regex);
    if (!match) {
      return null;
    }
    const candidate = cleanCode(match[1] || match[0]);
    return candidate || null;
  } catch (_error) {
    return null;
  }
}

function extractWithDefaults(content) {
  const base = String(content || "");

  const numeric = base.match(/\b\d{4,8}\b/);
  if (numeric) {
    return cleanCode(numeric[0]);
  }

  const alphanumericTokens = base.match(/\b[A-Z0-9]{6,10}\b/g) || [];
  const alphanumeric = alphanumericTokens.find((token) => /\d/.test(token) && /[A-Z]/.test(token));
  if (alphanumeric) {
    return cleanCode(alphanumeric);
  }

  return null;
}

function extractCode(message, options = {}) {
  const fullBodyText = stripHtmlTags(options.fullBodyHtml || options.fullBodyText || "");
  const parts = buildContentParts(message, fullBodyText);

  const providerRegex = options.providerCodeRegex || null;
  const providerResult = applyRegex(parts.combined, providerRegex);
  if (providerResult) {
    return { code: providerResult, source: "providerRegex" };
  }

  const numericFirst = extractWithDefaults(parts.subject + "\n" + parts.preview);
  if (numericFirst) {
    return { code: numericFirst, source: "subjectOrPreview" };
  }

  if (fullBodyText) {
    const fullBodyCode = extractWithDefaults(parts.combined);
    if (fullBodyCode) {
      return { code: fullBodyCode, source: "fullBody" };
    }
  }

  return { code: null, source: "none" };
}

module.exports = {
  stripHtmlTags,
  extractCode,
};
