const {
  getAuthCookieConfig,
  httpOnlyCookieBaseOptions,
  usesCrossOriginAuthCookies,
} = require("../../src/lib/authCookie");

describe("authCookie", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("production with CLIENT_ORIGIN uses cross-origin SameSite=None cookies", () => {
    process.env.NODE_ENV = "production";
    process.env.CLIENT_ORIGIN = "https://focusflow-client.onrender.com";
    delete process.env.COOKIE_SAME_SITE;

    expect(usesCrossOriginAuthCookies()).toBe(true);
    const opts = httpOnlyCookieBaseOptions();
    expect(opts).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
    });
  });

  test("getAuthCookieConfig exposes audit fields for /health", () => {
    process.env.NODE_ENV = "production";
    process.env.CLIENT_ORIGIN = "https://focusflow-client.onrender.com";

    const config = getAuthCookieConfig();
    expect(config).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
      domain: null,
      crossOrigin: true,
    });
  });

  test("local dev defaults to lax cookies without cross-origin flag", () => {
    process.env.NODE_ENV = "development";
    delete process.env.CLIENT_ORIGIN;
    delete process.env.COOKIE_SAME_SITE;

    const opts = httpOnlyCookieBaseOptions();
    expect(opts.sameSite).toBe("lax");
    expect(opts.secure).toBe(false);
  });
});
