const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

function parsePositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function clientIpKey(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) {
    return ipKeyGenerator({ ...req, ip: xff.split(",")[0].trim() });
  }
  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim()) {
    return ipKeyGenerator({ ...req, ip: realIp.trim() });
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

const noop = (_req, _res, next) => next();

/**
 * Build auth rate limiters.
 *
 * Design goals (production / BFF / shared hosting safe):
 * - Login, register, forgot-password each have their OWN limiter + store.
 * - Keys are email-first so unrelated users never share a bucket.
 * - Successful auth never consumes quota (skipSuccessfulRequests).
 * - Refresh is skipped when no refresh cookie (landing-page /me probes).
 * - Set *_RATE_LIMIT_MAX=0 to disable a specific limiter.
 */
function createAuthRateLimiters() {
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
    skipSuccessfulRequests: true,
  };

  function buildLimiter({
    name,
    windowMs,
    max,
    keyGenerator,
    message,
    skip,
    skipSuccessfulRequests = true,
  }) {
    if (max === 0) return noop;
    return rateLimit({
      ...rateLimitBase,
      windowMs,
      max,
      keyGenerator,
      message: { error: message },
      skip,
      skipSuccessfulRequests,
    });
  }

  const loginMax = parsePositiveInt(process.env.LOGIN_RATE_LIMIT_MAX, 100);
  const registerMax = parsePositiveInt(process.env.REGISTER_RATE_LIMIT_MAX, 50);
  const forgotMax = parsePositiveInt(process.env.FORGOT_PASSWORD_RATE_LIMIT_MAX, 20);
  const authMax = parsePositiveInt(process.env.AUTH_RATE_LIMIT_MAX, 30);
  const refreshMax = parsePositiveInt(process.env.AUTH_REFRESH_RATE_LIMIT_MAX, 120);

  const login = buildLimiter({
    name: "login",
    windowMs: 15 * 60 * 1000,
    max: loginMax,
    keyGenerator: (req) =>
      emailKey("login", req) ?? `login:ip:${clientIpKey(req)}`,
    message:
      "Too many sign-in attempts for this account. Please wait a few minutes and try again.",
  });

  const register = buildLimiter({
    name: "register",
    windowMs: 60 * 60 * 1000,
    max: registerMax,
    keyGenerator: (req) =>
      emailKey("register", req) ?? `register:ip:${clientIpKey(req)}`,
    message:
      "Too many sign-up attempts for this email. Please wait and try again.",
  });

  const forgotPassword = buildLimiter({
    name: "forgot-password",
    windowMs: 60 * 60 * 1000,
    max: forgotMax,
    keyGenerator: (req) =>
      emailKey("forgot", req) ?? `forgot:ip:${clientIpKey(req)}`,
    message:
      "Too many password reset requests for this email. Please wait and try again.",
  });

  const resetPassword = buildLimiter({
    name: "reset-password",
    windowMs: 60 * 1000,
    max: authMax,
    keyGenerator: (req) => `reset:ip:${clientIpKey(req)}`,
    message: "Too many reset attempts. Please try again shortly.",
  });

  const verifyEmail = buildLimiter({
    name: "verify-email",
    windowMs: 60 * 1000,
    max: authMax,
    keyGenerator: (req) => `verify:ip:${clientIpKey(req)}`,
    message: "Too many verification attempts. Please try again shortly.",
  });

  const resendVerification = buildLimiter({
    name: "resend-verification",
    windowMs: 60 * 60 * 1000,
    max: forgotMax,
    keyGenerator: (req) =>
      emailKey("resend", req) ?? `resend:ip:${clientIpKey(req)}`,
    message:
      "Too many verification emails requested. Please wait and try again.",
  });

  const refresh = buildLimiter({
    name: "refresh",
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
    skipSuccessfulRequests: false,
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

module.exports = {
  createAuthRateLimiters,
  clientIpKey,
  emailKey,
};
