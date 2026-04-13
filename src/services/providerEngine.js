const DEFAULT_PROVIDERS = [
  {
    name: "Webook",
    key: "webook",
    priority: 100,
    strict: true,
    senderDomain: ["webook.com"],
    subjectContains: ["verification", "verify", "code", "otp", "رمز", "تحقق", "تأكيد"],
    bodyContains: ["verification", "code", "otp", "رمز", "تحقق", "تأكيد"],
    codeRegex: "\\b\\d{4,8}\\b",
  },
];

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function extractSenderEmail(message) {
  return normalizeEmail(message?.from?.emailAddress?.address);
}

function extractSenderDomain(senderEmail) {
  const at = senderEmail.lastIndexOf("@");
  if (at < 0) {
    return "";
  }
  return senderEmail
    .slice(at + 1)
    .trim()
    .toLowerCase();
}

function domainMatches(domain, expected) {
  const normalizedDomain = String(domain || "").toLowerCase();
  const normalizedExpected = String(expected || "").toLowerCase();
  if (!normalizedDomain || !normalizedExpected) {
    return false;
  }
  return normalizedDomain === normalizedExpected || normalizedDomain.endsWith(`.${normalizedExpected}`);
}

function includesAny(haystack, terms) {
  const base = String(haystack || "").toLowerCase();
  if (!Array.isArray(terms) || terms.length === 0) {
    return true;
  }
  return terms.some((term) => base.includes(String(term || "").toLowerCase()));
}

function matchesSender(provider, senderEmail, senderDomain) {
  if (Array.isArray(provider.senderExact) && provider.senderExact.length > 0) {
    const exact = provider.senderExact.map(normalizeEmail);
    if (!exact.includes(senderEmail)) {
      return false;
    }
  }

  if (Array.isArray(provider.senderContains) && provider.senderContains.length > 0) {
    const ok = provider.senderContains.some((item) => senderEmail.includes(String(item).toLowerCase()));
    if (!ok) {
      return false;
    }
  }

  if (Array.isArray(provider.senderDomain) && provider.senderDomain.length > 0) {
    const ok = provider.senderDomain.some((domain) => domainMatches(senderDomain, domain));
    if (!ok) {
      return false;
    }
  }

  return true;
}

function normalizeProvider(provider) {
  return {
    name: provider.name || provider.key || "Unknown",
    key: provider.key || String(provider.name || "unknown").toLowerCase(),
    priority: Number(provider.priority || 0),
    strict: provider.strict !== false,
    senderExact: provider.senderExact || [],
    senderContains: provider.senderContains || [],
    senderDomain: provider.senderDomain || [],
    subjectContains: provider.subjectContains || [],
    bodyContains: provider.bodyContains || [],
    codeRegex: provider.codeRegex || null,
  };
}

function parseProvidersFromEnv() {
  if (!process.env.PROVIDER_RULES_JSON) {
    return [];
  }

  try {
    const parsed = JSON.parse(process.env.PROVIDER_RULES_JSON);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map(normalizeProvider);
  } catch (_error) {
    return [];
  }
}

function buildProviderSet(extraProviders = []) {
  const fromEnv = parseProvidersFromEnv();
  const merged = [...DEFAULT_PROVIDERS, ...fromEnv, ...extraProviders].map(normalizeProvider);
  merged.sort((a, b) => b.priority - a.priority);
  return merged;
}

function matchProvider(message, options = {}) {
  const senderEmail = extractSenderEmail(message);
  const senderDomain = extractSenderDomain(senderEmail);
  const subject = String(message.subject || "");
  const bodyPreview = String(message.bodyPreview || "");

  const providers = buildProviderSet(options.providers || []);
  const debug = {
    senderEmail,
    senderDomain,
    subject,
    providerMatched: false,
    reason: "no_provider_match",
  };

  for (const provider of providers) {
    const senderOk = matchesSender(provider, senderEmail, senderDomain);
    if (!senderOk) {
      continue;
    }

    const hasSubjectTerms = Array.isArray(provider.subjectContains) && provider.subjectContains.length > 0;
    const hasBodyTerms = Array.isArray(provider.bodyContains) && provider.bodyContains.length > 0;

    const subjectOk = includesAny(subject, provider.subjectContains);
    const bodyOk = includesAny(bodyPreview, provider.bodyContains);

    let keywordsOk = true;
    if (hasSubjectTerms || hasBodyTerms) {
      keywordsOk = subjectOk || bodyOk;
    }

    if (!provider.strict && hasSubjectTerms && hasBodyTerms) {
      keywordsOk = subjectOk || bodyOk;
    }

    if (!keywordsOk) {
      debug.reason = "keyword_mismatch";
      continue;
    }

    debug.providerMatched = true;
    debug.reason = "matched";

    return {
      matched: true,
      provider,
      reason: "matched",
      debug,
    };
  }

  return {
    matched: false,
    provider: null,
    reason: debug.reason,
    debug,
  };
}

module.exports = {
  DEFAULT_PROVIDERS,
  extractSenderDomain,
  extractSenderEmail,
  matchProvider,
  domainMatches,
};
