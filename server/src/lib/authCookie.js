const { durationToMs } = require("./durationMs");
const { accessCookieMaxAgeMs, refreshTtlMs } = require("./authTokens");

const ACCESS_TOKEN_COOKIE = "access_token";
const REFRESH_TOKEN_COOKIE = "refresh_token";

function isProduction() {
  return process.env.NODE_ENV === "production";
}

/**
 * Auth cookies on a different host than the web app (e.g. Vercel + API on Railway) are cross-site.
 * Use COOKIE_SAME_SITE=none in production so credentialed fetch() sends cookies (requires HTTPS / secure).
 * Same-host deployments can keep the default strict in production.
 */
function httpOnlyCookieBaseOptions() {
  const prod = isProduction();
  const raw = (process.env.COOKIE_SAME_SITE || "").toLowerCase();
  let sameSite = "lax";
  if (raw === "none" || raw === "strict" || raw === "lax") {
    sameSite = raw;
  } else if (prod) {
    sameSite = "strict";
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
  res.cookie(ACCESS_TOKEN_COOKIE, token, {
    ...httpOnlyCookieBaseOptions(),
    maxAge: accessCookieMaxAgeMs(),
  });
}

function setRefreshTokenCookie(res, plainToken) {
  res.cookie(REFRESH_TOKEN_COOKIE, plainToken, {
    ...httpOnlyCookieBaseOptions(),
    maxAge: refreshTtlMs(),
  });
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
