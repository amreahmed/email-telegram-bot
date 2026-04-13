const crypto = require("crypto");

const CIPHER_ALGO = "aes-256-gcm";

function getKey() {
  const secret = process.env.SESSION_SECRET;
  const salt = process.env.TOKEN_ENCRYPTION_SALT || "default_token_salt_change_me";

  if (!secret) {
    throw new Error("SESSION_SECRET is required for token encryption");
  }

  return crypto.scryptSync(secret, salt, 32);
}

function encrypt(plainText) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(CIPHER_ALGO, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    iv: iv.toString("hex"),
    content: encrypted.toString("hex"),
    tag: authTag.toString("hex"),
  };
}

function decrypt(payload) {
  if (!payload || !payload.iv || !payload.content || !payload.tag) {
    return null;
  }

  const decipher = crypto.createDecipheriv(CIPHER_ALGO, getKey(), Buffer.from(payload.iv, "hex"));

  decipher.setAuthTag(Buffer.from(payload.tag, "hex"));

  const decrypted = Buffer.concat([decipher.update(Buffer.from(payload.content, "hex")), decipher.final()]);

  return decrypted.toString("utf8");
}

module.exports = {
  encrypt,
  decrypt,
};
