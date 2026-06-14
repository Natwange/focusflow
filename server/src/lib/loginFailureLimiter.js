/**
 * Login brute-force protection that only counts real failed credential checks.
 *
 * Unlike express-rate-limit on the route, this:
 * - never blocks before the handler runs (unless prior failures exceeded the cap)
 * - only records a failure on 401 invalid credentials
 * - clears the counter on successful login
 * - does not count 429/500 responses toward the cap
 */

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const FALLBACK_MAX_FAILURES = 30;

function parsePositiveInt(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const trimmed = String(value).trim();
  if (!trimmed) return fallback;
  if (/^(false|off|disabled|no)$/i.test(trimmed)) return 0;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function isLoginLimiterExplicitlyDisabled() {
  const flag = String(process.env.DISABLE_LOGIN_FAILURE_LIMIT ?? "").trim();
  return flag === "1" || /^true$/i.test(flag);
}

/** @type {Map<string, number[]>} */
const failuresByEmail = new Map();
let limiterWasDisabled = false;

function normalizeEmail(email) {
  if (typeof email !== "string") return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed ? trimmed.slice(0, 200) : null;
}

function prune(timestamps, windowMs, now) {
  const cutoff = now - windowMs;
  return timestamps.filter((t) => t >= cutoff);
}

function getConfig() {
  const windowMs = DEFAULT_WINDOW_MS;
  if (isLoginLimiterExplicitlyDisabled()) {
    return { disabled: true, max: 0, windowMs, reason: "DISABLE_LOGIN_FAILURE_LIMIT" };
  }

  const max = parsePositiveInt(
    process.env.LOGIN_RATE_LIMIT_MAX,
    FALLBACK_MAX_FAILURES
  );
  if (max === 0) {
    return { disabled: true, max: 0, windowMs, reason: "LOGIN_RATE_LIMIT_MAX=0" };
  }
  return { disabled: false, max, windowMs, reason: null };
}

function ensureDisabledState(cfg) {
  if (!cfg.disabled) {
    limiterWasDisabled = false;
    return;
  }
  if (!limiterWasDisabled) {
    failuresByEmail.clear();
    limiterWasDisabled = true;
  }
}

/**
 * @param {string} email
 * @param {{ now?: Date }} [opts]
 */
function isLoginBlocked(email, { now = new Date() } = {}) {
  const cfg = getConfig();
  ensureDisabledState(cfg);
  if (cfg.disabled) return false;

  const key = normalizeEmail(email);
  if (!key) return false;

  const ts = now.getTime();
  const recent = prune(failuresByEmail.get(key) || [], cfg.windowMs, ts);
  failuresByEmail.set(key, recent);
  return recent.length >= cfg.max;
}

/**
 * @param {string} email
 * @param {{ now?: Date }} [opts]
 */
function recordLoginFailure(email, { now = new Date() } = {}) {
  const cfg = getConfig();
  ensureDisabledState(cfg);
  if (cfg.disabled) return;

  const key = normalizeEmail(email);
  if (!key) return;

  const ts = now.getTime();
  const recent = prune(failuresByEmail.get(key) || [], cfg.windowMs, ts);
  recent.push(ts);
  failuresByEmail.set(key, recent);
}

/**
 * @param {string} email
 */
function clearLoginFailures(email) {
  const key = normalizeEmail(email);
  if (!key) return;
  failuresByEmail.delete(key);
}

/** Test-only */
function resetLoginFailureLimiter() {
  failuresByEmail.clear();
  limiterWasDisabled = false;
}

function loginBlockedMessage() {
  return "Too many sign-in attempts for this account. Please wait a few minutes and try again.";
}

module.exports = {
  isLoginBlocked,
  recordLoginFailure,
  clearLoginFailures,
  resetLoginFailureLimiter,
  loginBlockedMessage,
  getLoginFailureLimiterConfig: getConfig,
};
