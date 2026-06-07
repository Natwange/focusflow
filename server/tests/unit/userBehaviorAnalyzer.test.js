const {
  analyzeUserBehavior,
  DAY_CODES,
} = require("../../src/lib/userBehaviorAnalyzer");

describe("analyzeUserBehavior", () => {
  const now = new Date("2026-05-20T12:00:00.000Z");

  test("empty data returns safe defaults", () => {
    const out = analyzeUserBehavior({ now, lookbackDays: 30 });
    expect(out.dayOfWeekStats).toHaveLength(7);
    expect(out.dayOfWeekStats.map((r) => r.day)).toEqual(DAY_CODES);
    expect(out.dataQuality.hasEnoughData).toBe(false);
    expect(out.productivityPatterns.strongestDays).toEqual([]);
    expect(out.summary).toMatch(/insufficient activity history/i);
  });

  test("includes Saturday and Sunday stats", () => {
    const tasks = [
      {
        status: "done",
        dueDate: "2026-05-16T10:00:00.000Z",
        completedAt: "2026-05-16T12:00:00.000Z",
      },
      {
        status: "done",
        dueDate: "2026-05-17T10:00:00.000Z",
        completedAt: "2026-05-17T12:00:00.000Z",
      },
    ];
    const out = analyzeUserBehavior({ tasks, now, lookbackDays: 30 });
    const sat = out.dayOfWeekStats.find((r) => r.day === "SAT");
    const sun = out.dayOfWeekStats.find((r) => r.day === "SUN");
    expect(sat?.completedTasks).toBe(1);
    expect(sun?.completedTasks).toBe(1);
  });

  test("detects strong weekend behavior", () => {
    const tasks = [
      ...Array.from({ length: 4 }, () => ({
        status: "done",
        dueDate: "2026-05-16T10:00:00.000Z",
        completedAt: "2026-05-16T12:00:00.000Z",
      })),
      ...Array.from({ length: 4 }, () => ({
        status: "done",
        dueDate: "2026-05-17T10:00:00.000Z",
        completedAt: "2026-05-17T12:00:00.000Z",
      })),
      ...Array.from({ length: 2 }, () => ({
        status: "done",
        dueDate: "2026-05-14T10:00:00.000Z",
        completedAt: "2026-05-14T12:00:00.000Z",
      })),
      ...Array.from({ length: 2 }, () => ({
        status: "done",
        dueDate: "2026-05-15T10:00:00.000Z",
        completedAt: "2026-05-15T12:00:00.000Z",
      })),
      {
        status: "done",
        dueDate: "2026-05-19T10:00:00.000Z",
        completedAt: "2026-05-19T12:00:00.000Z",
      },
    ];
    const focusSessions = [
      { duration: 50, startedAt: "2026-05-16T09:00:00.000Z" },
      { duration: 45, startedAt: "2026-05-17T09:00:00.000Z" },
      { duration: 10, startedAt: "2026-05-14T09:00:00.000Z" },
      { duration: 10, startedAt: "2026-05-15T09:00:00.000Z" },
    ];

    const out = analyzeUserBehavior({
      tasks,
      focusSessions,
      now,
      lookbackDays: 30,
    });

    expect(out.dataQuality.hasEnoughData).toBe(true);
    expect(out.productivityPatterns.weekendVsWeekdayComparison.weekendTasksCompleted).toBeGreaterThan(
      out.productivityPatterns.weekendVsWeekdayComparison.weekdayTasksCompleted
    );
    expect(out.productivityPatterns.strongestDays.some((d) => d === "SAT" || d === "SUN")).toBe(
      true
    );
  });

  test("detects weak weekday behavior", () => {
    const tasks = [
      ...Array.from({ length: 5 }, () => ({
        status: "todo",
        dueDate: "2026-05-19T10:00:00.000Z",
      })),
      ...Array.from({ length: 4 }, () => ({
        status: "done",
        dueDate: "2026-05-16T10:00:00.000Z",
        completedAt: "2026-05-16T12:00:00.000Z",
      })),
      ...Array.from({ length: 4 }, () => ({
        status: "done",
        dueDate: "2026-05-17T10:00:00.000Z",
        completedAt: "2026-05-17T12:00:00.000Z",
      })),
      ...Array.from({ length: 2 }, () => ({
        status: "done",
        dueDate: "2026-05-14T10:00:00.000Z",
        completedAt: "2026-05-14T12:00:00.000Z",
      })),
      ...Array.from({ length: 2 }, () => ({
        status: "done",
        dueDate: "2026-05-15T10:00:00.000Z",
        completedAt: "2026-05-15T12:00:00.000Z",
      })),
    ];

    const out = analyzeUserBehavior({ tasks, now, lookbackDays: 30 });

    expect(out.dataQuality.hasEnoughData).toBe(true);
    expect(out.productivityPatterns.weakestDays).toContain("TUE");
    const tue = out.dayOfWeekStats.find((r) => r.day === "TUE");
    expect(tue?.missedTasks).toBe(5);
  });

  test("detects focus session patterns", () => {
    const focusSessions = [
      { duration: 25, startedAt: "2026-05-20T09:00:00.000Z" },
      { duration: 25, startedAt: "2026-05-20T10:00:00.000Z" },
      { duration: 5, startedAt: "2026-05-19T09:00:00.000Z" },
      { duration: 5, startedAt: "2026-05-16T09:00:00.000Z" },
      { duration: 5, startedAt: "2026-05-18T09:00:00.000Z" },
    ];
    const tasks = Array.from({ length: 10 }, () => ({
      status: "done",
      dueDate: "2026-05-20T10:00:00.000Z",
      completedAt: "2026-05-20T11:00:00.000Z",
    }));

    const out = analyzeUserBehavior({ tasks, focusSessions, now, lookbackDays: 30 });

    expect(out.dataQuality.hasEnoughData).toBe(true);
    expect(out.focusPatterns.averageFocusMinutes).toBeGreaterThan(0);
    expect(out.focusPatterns.bestFocusDays).toContain("WED");
    expect(out.dayOfWeekStats.find((r) => r.day === "WED")?.focusMinutes).toBe(50);
  });

  test("low-data users return hasEnoughData false", () => {
    const out = analyzeUserBehavior({
      tasks: [{ status: "done", dueDate: "2026-05-13T10:00:00.000Z", completedAt: "2026-05-13T11:00:00.000Z" }],
      now,
      lookbackDays: 30,
    });
    expect(out.dataQuality.hasEnoughData).toBe(false);
    expect(out.dataQuality.confidence).toBeLessThanOrEqual(0.35);
    expect(out.summary).toMatch(/insufficient activity history/i);
  });

  test("summary contains no recommendation language", () => {
    const tasks = Array.from({ length: 12 }, () => ({
      status: "done",
      dueDate: "2026-05-20T10:00:00.000Z",
      completedAt: "2026-05-20T11:00:00.000Z",
    }));
    const out = analyzeUserBehavior({ tasks, now, lookbackDays: 30 });
    expect(out.summary).not.toMatch(/you should|recommend|try to|consider/i);
  });
});
