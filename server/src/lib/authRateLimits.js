const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

function parsePositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function clientIpKey(req) {
  const bffClient = req.headers["x-focusflow-client-ip"];
  if (typeof bffClient === "string" && bffClient.trim()) {
    return ipKeyGenerator({ ...req, ip: bffClient.trim() });
  }

  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) {
    return ipKeyGenerator({ ...req, ip: xff.split(",")[0].trim() });
  }
  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim()) {
    return ipKeyGenerator({ ...req, ip: realIp.trim() });
  }
  const cfIp = req.headers["cf-connecting-ip"];
  if (typeof cfIp === "string" && cfIp.trim()) {
    return ipKeyGenerator({ ...req, ip: cfIp.trim() });
  }
  return ipKeyGenerator(req);
}

function emailKey(prefix, req) {
  const email = req.body?.email;
  if (typeof email === "string" && email.trim()) {
    return `${prefix}:email:${email.trim().toLowerCase().slice(0, 200)}`;
  }
  return null;
}

function accountEmailKey(prefix, req) {
  const fromBody = emailKey(prefix, req);
  if (fromBody) return fromBody;
  const sessionEmail = req.user?.email;
  if (typeof sessionEmail === "string" && sessionEmail.trim()) {
    return `${prefix}:email:${sessionEmail.trim().toLowerCase().slice(0, 200)}`;
  }
  return null;
}

const noop = (_req, _res, next) => next();

let cachedLimiters = null;

function warnLegacyRateLimitEnv() {
  const legacy = process.env.AUTH_RATE_LIMIT_MAX;
  if (legacy == null || legacy === "") return;
  const n = Number(legacy);
  if (Number.isFinite(n) && n <= 15) {
    console.warn(
      "[auth] AUTH_RATE_LIMIT_MAX is very low (" +
        legacy +
        "). It only limits reset/verify routes — not login. " +
        "Remove it from production if login feels blocked; use LOGIN_RATE_LIMIT_MAX instead."
    );
  }
}

/**
 * Build auth rate limiters.
 *
 * Production / BFF rules:
 * - Login, register, forgot-password use EMAIL-ONLY keys (never a shared IP bucket).
 * - Limiters run on each auth route AFTER body validation so keys are reliable.
 * - Successful login/register never consumes quota.
 * - Refresh is skipped when no refresh cookie.
 */
function createAuthRateLimiters() {
  warnLegacyRateLimitEnv();

  if (process.env.DISABLE_AUTH_RATE_LIMIT === "1") {
    return {
      login: noop,
      register: noop,
      forgotPassword: noop,
      resetPassword: noop,
      verifyEmail: noop,
      resendVerification: noop,
      refresh: noop,
    };
  }

  const rateLimitBase = {
    standardHeaders: true,
    legacyHeaders: false,
    validate: { trustProxy: false, keyGeneratorIpFallback: false },
  };

  function buildLimiter({
    windowMs,
    max,
    keyGenerator,
    message,
    skip,
    requestWasSuccessful,
  }) {
    if (max === 0) return noop;
    return rateLimit({
      ...rateLimitBase,
      windowMs,
      max,
      keyGenerator,
      message: { error: message },
      skip,
      requestWasSuccessful,
    });
  }

  const loginMax = parsePositiveInt(process.env.LOGIN_RATE_LIMIT_MAX, 100);
  const registerMax = parsePositiveInt(process.env.REGISTER_RATE_LIMIT_MAX, 50);
  const forgotMax = parsePositiveInt(process.env.FORGOT_PASSWORD_RATE_LIMIT_MAX, 20);
  const authMax = parsePositiveInt(process.env.AUTH_RATE_LIMIT_MAX, 30);
  const refreshMax = parsePositiveInt(process.env.AUTH_REFRESH_RATE_LIMIT_MAX, 120);

  const loginSuccess = (_req, res) => res.statusCode === 200;

  const login = buildLimiter({
    windowMs: 15 * 60 * 1000,
    max: loginMax,
    skip: (req) => !emailKey("login", req),
    keyGenerator: (req) => emailKey("login", req),
    message:
      "Too many sign-in attempts for this account. Please wait a few minutes and try again.",
    requestWasSuccessful: loginSuccess,
  });

  if (process.env.NODE_ENV === "production") {
    console.info(
      `[auth] Login rate limit: email-scoped only (no shared IP bucket), max=${loginMax} failed attempts / 15 min per email`
    );
  }

  const register = buildLimiter({
    windowMs: 60 * 60 * 1000,
    max: registerMax,
    skip: (req) => !emailKey("register", req),
    keyGenerator: (req) => emailKey("register", req),
    message:
      "Too many sign-up attempts for this email. Please wait and try again.",
    requestWasSuccessful: (_req, res) => res.statusCode === 201,
  });

  const forgotPassword = buildLimiter({
    windowMs: 60 * 60 * 1000,
    max: forgotMax,
    skip: (req) => !emailKey("forgot", req),
    keyGenerator: (req) => emailKey("forgot", req),
    message:
      "Too many password reset requests for this email. Please wait and try again.",
    requestWasSuccessful: (_req, res) => res.statusCode === 200,
  });

  const resetPassword = buildLimiter({
    windowMs: 60 * 1000,
    max: authMax,
    keyGenerator: (req) => `reset:ip:${clientIpKey(req)}`,
    message: "Too many reset attempts. Please try again shortly.",
    requestWasSuccessful: (_req, res) => res.statusCode === 200,
  });

  const verifyEmail = buildLimiter({
    windowMs: 60 * 1000,
    max: authMax,
    keyGenerator: (req) => `verify:ip:${clientIpKey(req)}`,
    message: "Too many verification attempts. Please try again shortly.",
    requestWasSuccessful: (_req, res) => res.statusCode === 200,
  });

  const resendVerification = buildLimiter({
    windowMs: 60 * 60 * 1000,
    max: forgotMax,
    skip: (req) => !accountEmailKey("resend", req),
    keyGenerator: (req) => accountEmailKey("resend", req),
    message:
      "Too many verification emails requested. Please wait and try again.",
    requestWasSuccessful: (_req, res) => res.statusCode === 200,
  });

  const refresh = buildLimiter({
    windowMs: 60 * 1000,
    max: refreshMax,
    keyGenerator: (req) => {
      const token = req.cookies?.refresh_token;
      if (typeof token === "string" && token.trim()) {
        return `refresh:token:${token.trim().slice(0, 24)}`;
      }
      return `refresh:ip:${clientIpKey(req)}`;
    },
    skip: (req) => !req.cookies?.refresh_token,
    message: "Too many session refresh requests. Please try again shortly.",
    requestWasSuccessful: (_req, res) => res.statusCode === 200,
  });

  return {
    login,
    register,
    forgotPassword,
    resetPassword,
    verifyEmail,
    resendVerification,
    refresh,
  };
}

function getAuthRateLimiters() {
  if (!cachedLimiters) {
    cachedLimiters = createAuthRateLimiters();
  }
  return cachedLimiters;
}

/** Test-only: express-rate-limit stores are tied to limiter instances. */
function resetAuthRateLimiters() {
  cachedLimiters = null;
}

module.exports = {
  createAuthRateLimiters,
  getAuthRateLimiters,
  resetAuthRateLimiters,
  clientIpKey,
  emailKey,
  accountEmailKey,
};
