/**
 * Normalizes email for storage and lookup (trim + lowercase).
 */
function normalizeEmailInput(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Stricter than Zod's .email(): requires a domain with a dot and a TLD at least 2 chars.
 * This does not prove the inbox exists — only filters obvious junk.
 */
function isReasonableEmailShape(email) {
  if (!email || typeof email !== "string") return false;
  const at = email.lastIndexOf("@");
  if (at < 1) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!local || local.length > 64) return false;
  if (!domain || domain.length > 253) return false;
  if (!domain.includes(".")) return false;
  const parts = domain.split(".").filter(Boolean);
  const tld = parts[parts.length - 1];
  if (!tld || tld.length < 2) return false;
  if (email.includes("..")) return false;
  return true;
}

module.exports = {
  normalizeEmailInput,
  isReasonableEmailShape,
};
