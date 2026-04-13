const mongoose = require("mongoose");

const notificationRuleSchema = new mongoose.Schema(
  {
    telegramUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TelegramUser",
      required: true,
      index: true,
    },
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OutlookAccount",
      required: true,
      index: true,
    },
    senderContains: {
      type: String,
      default: null,
      trim: true,
    },
    senderExact: {
      type: String,
      default: null,
      trim: true,
      lowercase: true,
    },
    senderDomain: {
      type: String,
      default: null,
      trim: true,
      lowercase: true,
    },
    subjectContains: {
      type: String,
      default: null,
      trim: true,
    },
    bodyContains: {
      type: String,
      default: null,
      trim: true,
    },
    providerKey: {
      type: String,
      default: null,
      trim: true,
      lowercase: true,
      index: true,
    },
    codeRegex: {
      type: String,
      default: null,
      trim: true,
    },
    priority: {
      type: Number,
      default: 0,
      index: true,
    },
    strict: {
      type: Boolean,
      default: true,
    },
    hasAttachment: {
      type: Boolean,
      default: undefined,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("NotificationRule", notificationRuleSchema);
