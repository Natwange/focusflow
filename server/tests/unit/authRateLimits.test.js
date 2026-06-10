const { emailKey } = require("../../src/lib/authRateLimits");

describe("authRateLimits emailKey", () => {
  it("scopes keys by route prefix and email", () => {
    const req = { body: { email: "Recruiter@Example.com" } };
    expect(emailKey("login", req)).toBe("login:email:recruiter@example.com");
    expect(emailKey("register", req)).toBe("register:email:recruiter@example.com");
    expect(emailKey("login", req)).not.toBe(emailKey("register", req));
  });
});
