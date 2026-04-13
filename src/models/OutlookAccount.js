const mongoose = require("mongoose");

const encryptedTokenSchema = new mongoose.Schema(
  {
    iv: { type: String, required: true },
    content: { type: String, required: true },
    tag: { type: String, required: true },
  },
  { _id: false },
);

const outlookAccountSchema = new mongoose.Schema(
  {
    telegramUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TelegramUser",
      required: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    accessToken: {
      type: encryptedTokenSchema,
      required: true,
    },
    refreshToken: {
      type: encryptedTokenSchema,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    accountId: {
      type: String,
      required: true,
      index: true,
    },
    connectedAt: {
      type: Date,
      default: Date.now,
    },
    lastSyncAt: {
      type: Date,
      default: null,
    },
    lastSuccessAt: {
      type: Date,
      default: null,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    lastError: {
      type: String,
      default: null,
    },
    consecutiveFailures: {
      type: Number,
      default: 0,
      min: 0,
    },
    disabledAt: {
      type: Date,
      default: null,
    },
    reconnectRequired: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

outlookAccountSchema.index({ telegramUserId: 1, email: 1 }, { unique: true });

module.exports = mongoose.model("OutlookAccount", outlookAccountSchema);
