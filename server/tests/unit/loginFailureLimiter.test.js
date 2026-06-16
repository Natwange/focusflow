const {
  isLoginBlocked,
  recordLoginFailure,
  clearLoginFailures,
  resetLoginFailureLimiter,
} = require("../../src/lib/loginFailureLimiter");

describe("loginFailureLimiter", () => {
  const prev = { ...process.env };

  beforeEach(() => {
    resetLoginFailureLimiter();
    process.env.LOGIN_RATE_LIMIT_MAX = "4";
  });

  afterEach(() => {
    process.env = { ...prev };
    resetLoginFailureLimiter();
  });

  it("does not block before any failures", () => {
    expect(isLoginBlocked("user@example.com")).toBe(false);
  });

  it("blocks after max failures within the window", () => {
    const email = "user@example.com";
    for (let i = 0; i < 4; i++) {
      recordLoginFailure(email);
    }
    expect(isLoginBlocked(email)).toBe(true);
  });

  it("clears failures on successful login", () => {
    const email = "user@example.com";
    for (let i = 0; i < 3; i++) {
      recordLoginFailure(email);
    }
    clearLoginFailures(email);
    expect(isLoginBlocked(email)).toBe(false);
  });

  it("scopes limits per email", () => {
    for (let i = 0; i < 4; i++) {
      recordLoginFailure("alice@example.com");
    }
    expect(isLoginBlocked("alice@example.com")).toBe(true);
    expect(isLoginBlocked("bob@example.com")).toBe(false);
  });

  it("disables limiting when LOGIN_RATE_LIMIT_MAX is 0", () => {
    process.env.LOGIN_RATE_LIMIT_MAX = "0";
    const email = "user@example.com";
    for (let i = 0; i < 10; i++) {
      recordLoginFailure(email);
    }
    expect(isLoginBlocked(email)).toBe(false);
  });

  it("disables limiting when DISABLE_LOGIN_FAILURE_LIMIT is 1", () => {
    delete process.env.LOGIN_RATE_LIMIT_MAX;
    process.env.DISABLE_LOGIN_FAILURE_LIMIT = "1";
    const email = "user@example.com";
    for (let i = 0; i < 10; i++) {
      recordLoginFailure(email);
    }
    expect(isLoginBlocked(email)).toBe(false);
  });

  it("is disabled by default when LOGIN_RATE_LIMIT_MAX is unset", () => {
    delete process.env.LOGIN_RATE_LIMIT_MAX;
    delete process.env.DISABLE_LOGIN_FAILURE_LIMIT;
    const cfg = require("../../src/lib/loginFailureLimiter").getLoginFailureLimiterConfig();
    expect(cfg.disabled).toBe(true);
    const email = "user@example.com";
    for (let i = 0; i < 50; i++) {
      recordLoginFailure(email);
    }
    expect(isLoginBlocked(email)).toBe(false);
  });
});
