function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

const runtimeConfig = {
  graphPageSize: Math.min(Math.max(toInt(process.env.GRAPH_PAGE_SIZE, 50), 10), 200),
  graphMaxPages: Math.min(Math.max(toInt(process.env.GRAPH_MAX_PAGES, 10), 1), 50),
  accountProcessConcurrency: Math.min(Math.max(toInt(process.env.ACCOUNT_PROCESS_CONCURRENCY, 5), 1), 50),
  fetchOverlapSeconds: Math.min(Math.max(toInt(process.env.FETCH_OVERLAP_SECONDS, 45), 0), 300),
  maxConsecutiveFailures: Math.min(Math.max(toInt(process.env.MAX_CONSECUTIVE_FAILURES, 5), 1), 50),
  debugMailChecks: toBool(process.env.DEBUG_MAIL_CHECKS, false),
  graphRequestMaxRetries: Math.min(Math.max(toInt(process.env.GRAPH_REQUEST_MAX_RETRIES, 4), 1), 10),
};

module.exports = {
  runtimeConfig,
};
