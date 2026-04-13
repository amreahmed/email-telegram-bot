const mongoose = require("mongoose");

const telegramUserSchema = new mongoose.Schema(
  {
    telegramId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    username: {
      type: String,
      default: null,
    },
    firstName: {
      type: String,
      default: null,
    },
    preferredLanguage: {
      type: String,
      enum: ["ar", "en"],
      default: "ar",
    },
    oauthState: {
      type: String,
      default: null,
    },
    oauthStateExpiresAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
  },
);

module.exports = mongoose.model("TelegramUser", telegramUserSchema);
