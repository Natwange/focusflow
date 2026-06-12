const {
  emailKey,
  accountEmailKey,
  createAuthRateLimiters,
} = require("../../src/lib/authRateLimits");

describe("authRateLimits emailKey", () => {
  it("scopes keys by route prefix and email", () => {
    const req = { body: { email: "Recruiter@Example.com" } };
    expect(emailKey("login", req)).toBe("login:email:recruiter@example.com");
    expect(emailKey("register", req)).toBe("register:email:recruiter@example.com");
    expect(emailKey("login", req)).not.toBe(emailKey("register", req));
  });

  it("accountEmailKey falls back to session user email", () => {
    const req = {
      body: {},
      user: { email: "User@Example.com" },
    };
    expect(accountEmailKey("resend", req)).toBe("resend:email:user@example.com");
  });
});

describe("authRateLimits login limiter", () => {
  const prev = { ...process.env };

  afterEach(() => {
    process.env = { ...prev };
    jest.resetModules();
  });

  it("does not use a shared IP fallback key for login", () => {
    process.env.LOGIN_RATE_LIMIT_MAX = "2";
    delete process.env.DISABLE_AUTH_RATE_LIMIT;
    const { createAuthRateLimiters: create } = require("../../src/lib/authRateLimits");
    const limits = create();
    expect(limits.login).toBeDefined();
    expect(typeof limits.login).toBe("function");
    // Email-only design: key is derived from emailKey only (no login:ip: prefix).
    const req = { body: { email: "a@test.com" }, ip: "1.2.3.4", headers: {} };
    expect(emailKey("login", req)).toBe("login:email:a@test.com");
    expect(emailKey("login", req)).not.toContain("ip:");
  });
});
