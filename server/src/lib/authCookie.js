const { durationToMs } = require("./durationMs");
const { accessCookieMaxAgeMs, refreshTtlMs } = require("./authTokens");

const ACCESS_TOKEN_COOKIE = "access_token";
const REFRESH_TOKEN_COOKIE = "refresh_token";

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function httpOnlyCookieBaseOptions() {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: isProduction() ? "strict" : "lax",
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
