const {
  isUtcMidnightDueDate,
  utcCalendarDayKey,
  taskDueCalendarDayKey,
  taskMatchesDueDateQuery,
} = require("../../src/lib/calendarDueDate");

describe("calendarDueDate", () => {
  test("utc midnight due dates use UTC calendar day", () => {
    expect(isUtcMidnightDueDate("2026-06-15T00:00:00.000Z")).toBe(true);
    expect(utcCalendarDayKey("2026-06-15T00:00:00.000Z")).toBe("2026-06-15");
    expect(taskDueCalendarDayKey({ dueDate: "2026-06-15T00:00:00.000Z" })).toBe(
      "2026-06-15"
    );
  });

  test("timed due dates use local calendar day in user tz", () => {
    const iso = "2026-06-14T18:30:00.000Z";
    expect(isUtcMidnightDueDate(iso)).toBe(false);
    const key = taskDueCalendarDayKey(
      { dueDate: iso },
      240
    );
    expect(typeof key).toBe("string");
  });

  test("June 15 UTC plan task is not due on June 14 local today window", () => {
    const task = { dueDate: "2026-06-15T00:00:00.000Z", status: "todo" };
    const start = new Date("2026-06-14T04:00:00.000Z");
    const end = new Date("2026-06-15T03:59:59.999Z");
    expect(
      taskMatchesDueDateQuery(task, {
        startDate: start,
        endDate: end,
        includeOverdue: true,
        tzOffsetMinutes: 240,
      })
    ).toBe(false);
  });

  test("June 15 UTC plan task matches June 15 local day query", () => {
    const task = { dueDate: "2026-06-15T00:00:00.000Z", status: "todo" };
    const start = new Date("2026-06-15T04:00:00.000Z");
    const end = new Date("2026-06-16T03:59:59.999Z");
    expect(
      taskMatchesDueDateQuery(task, {
        startDate: start,
        endDate: end,
        includeOverdue: false,
        tzOffsetMinutes: 240,
      })
    ).toBe(true);
  });

  test("completed overdue tasks are not included in later weeks", () => {
    const task = { dueDate: "2026-05-12T00:00:00.000Z", status: "done" };
    const start = new Date("2026-06-15T04:00:00.000Z");
    const end = new Date("2026-06-22T03:59:59.999Z");
    expect(
      taskMatchesDueDateQuery(task, {
        startDate: start,
        endDate: end,
        includeOverdue: true,
        tzOffsetMinutes: 240,
      })
    ).toBe(false);
  });

  test("incomplete overdue tasks still appear when includeOverdue is true", () => {
    const task = { dueDate: "2026-05-12T00:00:00.000Z", status: "todo" };
    const start = new Date("2026-06-15T04:00:00.000Z");
    const end = new Date("2026-06-22T03:59:59.999Z");
    expect(
      taskMatchesDueDateQuery(task, {
        startDate: start,
        endDate: end,
        includeOverdue: true,
        tzOffsetMinutes: 240,
      })
    ).toBe(true);
  });
});
