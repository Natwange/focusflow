const {
  parseScheduledTaskRange,
  parseCreateTaskDetails,
  parseRescheduleTaskDetails,
} = require("../../src/agent/ruleParser");

describe("ruleParser scheduled tasks", () => {
  test("parses range: Add LeetCode from 2 PM to 3 PM tomorrow", () => {
    const result = parseScheduledTaskRange(
      "Add LeetCode from 2 PM to 3 PM tomorrow",
      0
    );
    expect(result.ok).toBe(true);
    expect(result.title).toBe("LeetCode");
    expect(result.startTime).toBeTruthy();
    expect(result.endTime).toBeTruthy();
    expect(Date.parse(result.endTime)).toBeGreaterThan(Date.parse(result.startTime));
  });

  test("parseCreateTaskDetails uses scheduled range", () => {
    const result = parseCreateTaskDetails(
      "Schedule FocusFlow work from 6:30 PM to 8 PM today",
      0
    );
    expect(result.ok).toBe(true);
    expect(result.title).toMatch(/FocusFlow work/i);
    expect(result.startTime).toBeTruthy();
    expect(result.endTime).toBeTruthy();
  });

  test("asks for end time when moving task to single time", () => {
    const result = parseRescheduleTaskDetails("Move my reading task to 9 AM", 0);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing_end_time");
    expect(result.clarifyMessage).toMatch(/end time/i);
  });
});
