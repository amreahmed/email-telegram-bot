function normalizeLanguage(value) {
  return value === "en" ? "en" : "ar";
}

function providerLabel(provider, language) {
  if (!provider) {
    return language === "en" ? "Verification" : "التحقق";
  }
  return provider.name || provider.key || (language === "en" ? "Verification" : "التحقق");
}

function buildOtpNotification({ language, provider, code, accountEmail }) {
  const lang = normalizeLanguage(language);
  const label = providerLabel(provider, lang);

  if (lang === "ar") {
    return [`🔔 ${label}`, `الكود: ${code || "غير متوفر"}`, `الحساب: ${accountEmail}`].join("\n");
  }

  return [`🔔 ${label} Code`, `Code: ${code || "Not found"}`, `Email: ${accountEmail}`].join("\n");
}

module.exports = {
  buildOtpNotification,
};
