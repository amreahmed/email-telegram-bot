const mongoose = require("mongoose");

const mailLogSchema = new mongoose.Schema(
  {
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OutlookAccount",
      required: true,
      index: true,
    },
    messageId: {
      type: String,
      required: true,
    },
    provider: {
      type: String,
      default: null,
      index: true,
    },
    extractedCode: {
      type: String,
      default: null,
      trim: true,
    },
    notifiedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

mailLogSchema.index({ accountId: 1, messageId: 1 }, { unique: true });

module.exports = mongoose.model("MailLog", mailLogSchema);
