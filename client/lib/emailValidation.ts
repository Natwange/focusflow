/**
 * Client-side email checks (keep in sync with `server/src/lib/emailPolicy.js`).
 */

export function normalizeEmail(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase();
}

/** True if the string looks like a real address with a domain (not proof the inbox exists). */
export function isReasonableEmail(raw: string): boolean {
  const email = normalizeEmail(raw);
  if (!email) return false;
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
  // Basic pattern browsers understand; still validated on the server.
  const basic = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return basic.test(email);
}
