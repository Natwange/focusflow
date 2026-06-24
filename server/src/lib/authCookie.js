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
 * Cross-origin SPA + API (e.g. focusflow-client + focusflow-server on Render) requires
 * SameSite=None; Secure so the browser stores cookies on the API host and sends them
 * on credentialed fetch from the web origin.
 */
function usesCrossOriginAuthCookies() {
  const crossOriginFlag = String(process.env.COOKIE_CROSS_ORIGIN ?? "").toLowerCase();
  if (crossOriginFlag === "1" || crossOriginFlag === "true") return true;

  const sameSiteEnv = String(process.env.COOKIE_SAME_SITE ?? "").toLowerCase();
  if (sameSiteEnv === "none") return true;

  if (isProduction() && process.env.CLIENT_ORIGIN?.trim()) {
    return true;
  }

  return false;
}

/**
 * Auth cookies on a different host than the web app (e.g. Vercel + API on Railway) are cross-site.
 * Mobile browsers are especially strict with auth cookies on cross-origin fetch requests.
 * Default production behavior to SameSite=None (+Secure) so sign-in persists on mobile.
 * You can still override via COOKIE_SAME_SITE to "strict" or "lax" if needed.
 */
function httpOnlyCookieBaseOptions() {
  const crossOrigin = usesCrossOriginAuthCookies();
  const raw = (process.env.COOKIE_SAME_SITE || "").toLowerCase();
  let sameSite = crossOrigin ? "none" : "lax";
  if (raw === "none" || raw === "strict" || raw === "lax") {
    sameSite = raw;
  }
  const secure = sameSite === "none" ? true : isProduction();
  return {
    httpOnly: true,
    secure,
    sameSite,
    path: "/",
  };
}

/** For /health audits — describes Set-Cookie attributes on auth responses. */
function getAuthCookieConfig() {
  const opts = httpOnlyCookieBaseOptions();
  return {
    accessTokenName: ACCESS_TOKEN_COOKIE,
    refreshTokenName: REFRESH_TOKEN_COOKIE,
    httpOnly: opts.httpOnly,
    secure: opts.secure,
    sameSite: opts.sameSite,
    path: opts.path,
    crossOrigin: usesCrossOriginAuthCookies(),
    persistent: usePersistentAuthCookies(),
    domain: null,
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
  getAuthCookieConfig,
  httpOnlyCookieBaseOptions,
  usesCrossOriginAuthCookies,
};
