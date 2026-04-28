const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { durationToMs } = require("./durationMs");

function hashRefreshToken(plain) {
  return crypto.createHash("sha256").update(plain, "utf8").digest("hex");
}

function generateRefreshToken() {
  const plain = crypto.randomBytes(32).toString("base64url");
  return { plain, hash: hashRefreshToken(plain) };
}

function accessJwtExpiresIn() {
  return (
    process.env.JWT_ACCESS_EXPIRES_IN ||
    process.env.JWT_EXPIRES_IN ||
    "15m"
  );
}

function accessCookieMaxAgeMs() {
  return durationToMs(accessJwtExpiresIn(), "15m");
}

function refreshTtlMs() {
  return durationToMs(process.env.JWT_REFRESH_EXPIRES_IN || "7d", "7d");
}

function refreshExpiresAt() {
  return new Date(Date.now() + refreshTtlMs());
}

function issueAccessToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name || "" },
    process.env.JWT_SECRET,
    { expiresIn: accessJwtExpiresIn() }
  );
}

module.exports = {
  hashRefreshToken,
  generateRefreshToken,
  issueAccessToken,
  accessCookieMaxAgeMs,
  refreshTtlMs,
  refreshExpiresAt,
};
