const SECRET_PATTERNS = [
  /\bpassword\b/i,
  /\bpasswd\b/i,
  /\bapi[_\s-]?key\b/i,
  /\bsecret\b/i,
  /\btoken\b/i,
  /\bbearer\s+[a-z0-9._-]{8,}/i,
  /\bsk-[a-z0-9]{10,}/i,
  /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+\./,
  /\bcookie\b/i,
  /\bauthorization\b/i,
  /\bprivate[_\s-]?key\b/i,
];

const MAX_MEMORY_LENGTH = 500;

function validateMemoryContent(content) {
  const text = String(content ?? "").trim();
  if (!text) {
    return { ok: false, error: "Memory content cannot be empty." };
  }
  if (text.length > MAX_MEMORY_LENGTH) {
    return { ok: false, error: "Memory content is too long." };
  }
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      return {
        ok: false,
        error: "Cannot store secrets, credentials, or auth data in memory.",
      };
    }
  }
  return { ok: true, text };
}

module.exports = {
  MAX_MEMORY_LENGTH,
  validateMemoryContent,
};
