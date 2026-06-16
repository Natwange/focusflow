/**
 * Login brute-force protection (opt-in only).
 *
 * Disabled by default — no env var required. Set LOGIN_RATE_LIMIT_MAX to a
 * positive integer (e.g. 30) to enable per-email failed-password limiting.
 *
 * Unlike express-rate-limit on the route, this:
 * - only records a failure on 401 invalid credentials
 * - clears the counter on successful login
 * - does not count 429/500 responses toward the cap
 */

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

function parsePositiveInt(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (/^(false|off|disabled|no)$/i.test(trimmed)) return 0;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
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
    return {
      disabled: true,
      max: 0,
      windowMs,
      reason: "DISABLE_LOGIN_FAILURE_LIMIT",
    };
  }

  const parsed = parsePositiveInt(process.env.LOGIN_RATE_LIMIT_MAX);

  // Opt-in: unset or empty env → limiter OFF (safe default for deploys without env sync).
  if (parsed === null) {
    return {
      disabled: true,
      max: 0,
      windowMs,
      reason: "login_limit_opt_in_unset",
    };
  }

  if (parsed === 0) {
    return {
      disabled: true,
      max: 0,
      windowMs,
      reason: "LOGIN_RATE_LIMIT_MAX=0",
    };
  }

  return { disabled: false, max: parsed, windowMs, reason: null };
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
