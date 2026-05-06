const { hashRefreshToken, generateRefreshToken } = require("./authTokens");

/** @returns {Date} */
function passwordResetExpiresAt() {
  const hours = Number(process.env.PASSWORD_RESET_TTL_HOURS || 1);
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

/** @returns {Date} */
function emailVerificationExpiresAt() {
  const hours = Number(process.env.EMAIL_VERIFY_TTL_HOURS || 48);
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

/**
 * Same storage shape as refresh tokens: random base64url secret + sha256 hash in DB.
 */
function generateOpaqueToken() {
  return generateRefreshToken();
}

function hashOpaqueToken(plain) {
  return hashRefreshToken(plain);
}

module.exports = {
  generateOpaqueToken,
  hashOpaqueToken,
  passwordResetExpiresAt,
  emailVerificationExpiresAt,
};
