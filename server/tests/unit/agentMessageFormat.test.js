const {
  formatCreatedTaskSummary,
  formatLocalDateTime,
  formatLocalTimeRange,
} = require("../../src/lib/agentMessageFormat");

describe("agentMessageFormat", () => {
  test("formats created scheduled task in local time", () => {
    // tzOffsetMinutes 300 = US Central (UTC-5 in summer would be 300? Actually getTimezoneOffset for CDT is 300)
    const summary = formatCreatedTaskSummary(
      {
        title: "Meeting with Kabir",
        dueDate: "2026-06-19T19:30:00.000Z",
        startTime: "2026-06-19T19:30:00.000Z",
        endTime: "2026-06-19T20:00:00.000Z",
      },
      300
    );
    expect(summary).toMatch(/Meeting with Kabir/i);
    expect(summary).toMatch(/June 19/i);
    expect(summary).toMatch(/2:30 PM/i);
    expect(summary).toMatch(/3:00 PM/i);
    expect(summary).not.toMatch(/T19:30/);
  });

  test("formats local time range on same day", () => {
    const range = formatLocalTimeRange(
      "2026-06-19T19:30:00.000Z",
      "2026-06-19T20:00:00.000Z",
      300
    );
    expect(range).toBe("June 19 from 2:30 PM to 3:00 PM");
  });

  test("formats due date without schedule", () => {
    const summary = formatCreatedTaskSummary(
      {
        title: "Groceries",
        dueDate: "2026-06-20T15:00:00.000Z",
        startTime: null,
        endTime: null,
      },
      0
    );
    expect(summary).toMatch(/Groceries/i);
    expect(summary).toMatch(/June 20, 2026 at 3:00 PM/i);
  });
});
