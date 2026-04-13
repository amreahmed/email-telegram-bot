const mongoose = require("mongoose");
const logger = require("../utils/logger");

async function connectDB() {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    throw new Error("MONGODB_URI is required");
  }

  mongoose.set("strictQuery", true);

  await mongoose.connect(mongoUri, {
    autoIndex: true,
    serverSelectionTimeoutMS: 10000,
  });

  logger.info("MongoDB connected");
}

module.exports = {
  connectDB,
};
