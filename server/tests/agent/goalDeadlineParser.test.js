const { parseGoalDeadline } = require("../../src/lib/goalDeadlineParser");

describe("goalDeadlineParser", () => {
  const now = new Date("2026-06-01T12:00:00.000Z");

  it("parses ISO deadline", () => {
    const iso = parseGoalDeadline("2026-06-15T00:00:00.000Z", 0, now);
    expect(iso).toMatch(/2026-06-15/);
  });

  it("parses in N days", () => {
    const iso = parseGoalDeadline("in 7 days", 0, now);
    expect(iso).toMatch(/2026-06-08/);
  });

  it("parses in N weeks", () => {
    const iso = parseGoalDeadline("in 2 weeks", 0, now);
    expect(iso).toMatch(/2026-06-15/);
  });

  it("parses by YYYY-MM-DD", () => {
    const iso = parseGoalDeadline("by 2026-07-01", 0, now);
    expect(iso).toMatch(/2026-07-01/);
  });

  it("parses by month name", () => {
    const iso = parseGoalDeadline("by June 15", 0, now);
    expect(iso).toMatch(/2026-06-15/);
  });

  it("rejects invalid deadline text", () => {
    expect(() => parseGoalDeadline("whenever", 0, now)).toThrow(/Invalid deadline/i);
  });
});
