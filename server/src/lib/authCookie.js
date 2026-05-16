const { accessCookieMaxAgeMs, refreshTtlMs } = require("./authTokens");

const ACCESS_TOKEN_COOKIE = "access_token";
const REFRESH_TOKEN_COOKIE = "refresh_token";

/** When false (default), auth cookies are session cookies (cleared when the browser closes). */
function usePersistentAuthCookies() {
  const raw = (process.env.COOKIE_PERSIST || "").toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function isProduction() {
  return process.env.NODE_ENV === "production";
}

/**
 * Auth cookies on a different host than the web app (e.g. Vercel + API on Railway) are cross-site.
 * Mobile browsers are especially strict with auth cookies on cross-origin fetch requests.
 * Default production behavior to SameSite=None (+Secure) so sign-in persists on mobile.
 * You can still override via COOKIE_SAME_SITE to "strict" or "lax" if needed.
 */
function httpOnlyCookieBaseOptions() {
  const prod = isProduction();
  const raw = (process.env.COOKIE_SAME_SITE || "").toLowerCase();
  let sameSite = "lax";
  if (raw === "none" || raw === "strict" || raw === "lax") {
    sameSite = raw;
  } else if (prod) {
    sameSite = "none";
  }
  const secure = sameSite === "none" ? true : prod;
  return {
    httpOnly: true,
    secure,
    sameSite,
    path: "/",
  };
}

function setAccessTokenCookie(res, token) {
  const opts = { ...httpOnlyCookieBaseOptions() };
  if (usePersistentAuthCookies()) {
    opts.maxAge = accessCookieMaxAgeMs();
  }
  res.cookie(ACCESS_TOKEN_COOKIE, token, opts);
}

function setRefreshTokenCookie(res, plainToken) {
  const opts = { ...httpOnlyCookieBaseOptions() };
  if (usePersistentAuthCookies()) {
    opts.maxAge = refreshTtlMs();
  }
  res.cookie(REFRESH_TOKEN_COOKIE, plainToken, opts);
}

function clearAccessTokenCookie(res) {
  res.clearCookie(ACCESS_TOKEN_COOKIE, httpOnlyCookieBaseOptions());
}

function clearRefreshTokenCookie(res) {
  res.clearCookie(REFRESH_TOKEN_COOKIE, httpOnlyCookieBaseOptions());
}

function clearSessionCookies(res) {
  clearAccessTokenCookie(res);
  clearRefreshTokenCookie(res);
}

module.exports = {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  setAccessTokenCookie,
  setRefreshTokenCookie,
  clearSessionCookies,
  clearAccessTokenCookie,
  clearRefreshTokenCookie,
};
