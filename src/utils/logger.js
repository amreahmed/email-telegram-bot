const winston = require("winston");

const isProduction = process.env.NODE_ENV === "production";
const logLevel = process.env.LOG_LEVEL || (isProduction ? "info" : "debug");
const supportsColor = !isProduction && process.stdout && process.stdout.isTTY;

const { combine, timestamp, errors, splat, json, printf } = winston.format;

winston.addColors({
  info: "green",
  warn: "yellow",
  error: "red",
  debug: "cyan",
});

function pickMeta(info) {
  const reserved = new Set(["level", "message", "timestamp", "context"]);
  const out = {};
  for (const [key, value] of Object.entries(info)) {
    if (!reserved.has(key)) {
      out[key] = value;
    }
  }
  return out;
}

function levelToLabel(level) {
  return String(level || "info")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .toUpperCase()
    .padEnd(5, " ");
}

function colorLevel(levelLabel, level) {
  if (!supportsColor) {
    return levelLabel;
  }

  const codes = {
    info: "\u001b[32m",
    warn: "\u001b[33m",
    error: "\u001b[31m",
    debug: "\u001b[36m",
  };
  const reset = "\u001b[0m";
  const code = codes[String(level || "info").toLowerCase()] || "";
  return code ? `${code}${levelLabel}${reset}` : levelLabel;
}

function stringifyMeta(meta) {
  if (!meta || Object.keys(meta).length === 0) {
    return "";
  }

  try {
    return ` ${JSON.stringify(meta)}`;
  } catch (_error) {
    return " [meta_unserializable]";
  }
}

const prettyFormat = combine(
  timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  errors({ stack: true }),
  splat(),
  printf((info) => {
    const levelLabel = levelToLabel(info.level);
    const level = colorLevel(levelLabel, info.level);
    const time = info.timestamp;
    const context = info.context ? ` [${info.context}]` : "";
    const meta = pickMeta(info);
    return `${level} ${time}${context} ${info.message}${stringifyMeta(meta)}`;
  }),
);

const productionFormat = combine(timestamp(), errors({ stack: true }), splat(), json());

const baseLogger = winston.createLogger({
  level: logLevel,
  format: isProduction ? productionFormat : prettyFormat,
  transports: [new winston.transports.Console()],
});

function normalizeMeta(meta) {
  if (meta === undefined || meta === null) {
    return {};
  }

  if (meta instanceof Error) {
    return {
      error: meta.message,
      stack: meta.stack,
      name: meta.name,
    };
  }

  if (typeof meta === "object") {
    const out = { ...meta };
    if (out.error instanceof Error) {
      out.error = out.error.message;
      if (!out.stack) {
        out.stack = meta.error.stack;
      }
    }
    return out;
  }

  return { meta };
}

function write(level, message, meta, context) {
  const payload = normalizeMeta(meta);
  if (context && !payload.context) {
    payload.context = context;
  }
  baseLogger.log({
    level,
    message,
    ...payload,
  });
}

function withContext(context) {
  return {
    info(message, meta) {
      write("info", message, meta, context);
    },
    warn(message, meta) {
      write("warn", message, meta, context);
    },
    error(message, meta) {
      write("error", message, meta, context);
    },
    debug(message, meta) {
      write("debug", message, meta, context);
    },
    withContext,
  };
}

module.exports = {
  info(message, meta) {
    write("info", message, meta);
  },
  warn(message, meta) {
    write("warn", message, meta);
  },
  error(message, meta) {
    write("error", message, meta);
  },
  debug(message, meta) {
    write("debug", message, meta);
  },
  withContext,
};
