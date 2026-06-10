const { parseGoalDeadline } = require("../../src/lib/goalDeadlineParser");

describe("goalDeadlineParser", () => {
  const now = new Date("2026-06-10T12:00:00.000Z");

  it("parses ISO deadline", () => {
    const iso = parseGoalDeadline("2026-06-15T00:00:00.000Z", 0, now);
    expect(iso).toMatch(/2026-06-15/);
  });

  it("parses bare ISO date", () => {
    const iso = parseGoalDeadline("2026-07-10", 0, now);
    expect(iso).toMatch(/2026-07-10/);
  });

  it("parses in N days", () => {
    const iso = parseGoalDeadline("in 7 days", 0, now);
    expect(iso).toMatch(/2026-06-17/);
  });

  it("parses in N weeks", () => {
    const iso = parseGoalDeadline("in 2 weeks", 0, now);
    expect(iso).toMatch(/2026-06-24/);
  });

  it("parses by YYYY-MM-DD", () => {
    const iso = parseGoalDeadline("by 2026-07-01", 0, now);
    expect(iso).toMatch(/2026-07-01/);
  });

  it("parses by month name", () => {
    const iso = parseGoalDeadline("by June 15", 0, now);
    expect(iso).toMatch(/2026-06-15/);
  });

  it("parses July 10 without by prefix", () => {
    const iso = parseGoalDeadline("July 10", 0, now);
    expect(iso).toMatch(/2026-07-10/);
  });

  it("parses July 10th with ordinal", () => {
    const iso = parseGoalDeadline("July 10th", 0, now);
    expect(iso).toMatch(/2026-07-10/);
  });

  it("parses extend to July 10th inside a phrase", () => {
    const iso = parseGoalDeadline("extend the deadline to July 10th", 0, now);
    expect(iso).toMatch(/2026-07-10/);
  });

  it("rolls month-day to next year when already passed this year", () => {
    const iso = parseGoalDeadline("March 1", 0, now);
    expect(iso).toMatch(/2027-03-01/);
  });

  it("parses day month order", () => {
    const iso = parseGoalDeadline("10 July 2026", 0, now);
    expect(iso).toMatch(/2026-07-10/);
  });

  it("rejects invalid deadline text", () => {
    expect(() => parseGoalDeadline("whenever", 0, now)).toThrow(/Invalid deadline/i);
  });
});
