const {
  analyzeUserActivityPatterns,
  WEEKDAY_ORDER,
} = require("../../src/lib/userActivityPatternAnalyzer");

describe("analyzeUserActivityPatterns", () => {
  const now = new Date("2026-05-20T12:00:00.000Z");

  test("identifies best days from task + focus behavior", () => {
    const tasks = [
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `t-tue-${i}`,
        status: "done",
        dueDate: "2026-05-12T10:00:00.000Z",
        completedAt: "2026-05-12T15:00:00.000Z",
        goalId: "g1",
      })),
      {
        id: "t-thu",
        status: "done",
        dueDate: "2026-05-14T10:00:00.000Z",
        completedAt: "2026-05-14T11:00:00.000Z",
      },
    ];
    const focusSessions = [
      { duration: 25, startTime: "2026-05-12T09:00:00.000Z" },
      { duration: 25, startTime: "2026-05-12T10:00:00.000Z" },
      { duration: 25, startTime: "2026-05-12T11:00:00.000Z" },
      { duration: 5, startTime: "2026-05-14T14:00:00.000Z" },
    ];

    const out = analyzeUserActivityPatterns({
      tasks,
      focusSessions,
      now,
    });

    expect(out.bestDays.length).toBeGreaterThan(0);
    expect(out.bestDays[0]).toBe("Tuesday");
    expect(out.weekdayStats.find((r) => r.weekday === "Tuesday")?.focusMinutes).toBe(75);
    expect(out.weekdayStats.find((r) => r.weekday === "Tuesday")?.completedTasks).toBe(5);
    expect(out.summary).not.toMatch(/Limited activity data/);
    expect(out.lowData).toBe(false);
  });

  test("identifies weak days from missed tasks + low focus", () => {
    const tasks = [
      ...Array.from({ length: 4 }, (_, i) => ({
        id: `m-${i}`,
        status: "todo",
        dueDate: "2026-05-11T10:00:00.000Z",
      })),
      {
        id: "ok",
        status: "done",
        dueDate: "2026-05-12T10:00:00.000Z",
        completedAt: "2026-05-12T12:00:00.000Z",
      },
    ];
    const focusSessions = [
      { duration: 40, startTime: "2026-05-12T13:00:00.000Z" },
      { duration: 40, startTime: "2026-05-13T13:00:00.000Z" },
    ];

    const out = analyzeUserActivityPatterns({ tasks, focusSessions, now });

    expect(out.weakDays.length).toBeGreaterThan(0);
    expect(out.weakDays).toContain("Monday");
    const mon = out.weekdayStats.find((r) => r.weekday === "Monday");
    expect(mon?.missedTasks).toBe(4);
    expect(mon?.focusMinutes).toBe(0);
  });

  test("works with tasks only", () => {
    const tasks = Array.from({ length: 6 }, (_, i) => ({
      id: `x-${i}`,
      status: i < 4 ? "done" : "todo",
      dueDate: "2026-05-13T10:00:00.000Z",
      completedAt: i < 4 ? "2026-05-13T12:00:00.000Z" : null,
    }));

    const out = analyzeUserActivityPatterns({ tasks, now });

    expect(out.focusSignals.totalFocusMinutes).toBe(0);
    expect(out.taskSignals.totalTasks).toBe(6);
    expect(out.taskSignals.completedTasks).toBe(4);
    expect(WEEKDAY_ORDER).toContain(out.weekdayStats[0].weekday);
  });

  test("works with focus sessions only", () => {
    const focusSessions = [
      { duration: 30, startedAt: "2026-05-14T08:00:00.000Z" },
      { duration: 45, createdAt: "2026-05-15T08:00:00.000Z" },
      { duration: 20, startTime: "2026-05-16T08:00:00.000Z" },
      { duration: 10, startTime: "2026-05-17T08:00:00.000Z" },
      { duration: 15, startTime: "2026-05-18T08:00:00.000Z" },
    ];

    const out = analyzeUserActivityPatterns({ focusSessions, now });

    expect(out.taskSignals.totalTasks).toBe(0);
    expect(out.focusSignals.totalFocusMinutes).toBe(120);
    expect(out.focusSignals.averageFocusMinutesPerActiveDay).toBeGreaterThan(0);
    expect(out.summary).toMatch(/0 tasks/);
  });

  test("works with empty inputs safely", () => {
    const out = analyzeUserActivityPatterns({ now });
    expect(out.weekdayStats).toHaveLength(7);
    expect(out.bestDays).toEqual([]);
    expect(out.weakDays).toEqual([]);
    expect(out.taskSignals.completionRate).toBe(0);
    expect(out.agentSignals.totalRecommendations).toBe(0);
    expect(out.summary).toMatch(/Limited activity data/);
    expect(out.lowData).toBe(true);
  });

  test("includes agent acceptance signals when agentRuns are provided", () => {
    const runs = [
      { id: "1", createdAt: "2026-05-12T10:00:00.000Z", acceptedByUser: true },
      { id: "2", createdAt: "2026-05-12T11:00:00.000Z", acceptedByUser: false },
      { id: "3", createdAt: "2026-05-13T10:00:00.000Z", acceptedByUser: true },
    ];
    const tasks = Array.from({ length: 5 }, (_, i) => ({
      id: `a-${i}`,
      status: "done",
      dueDate: "2026-05-14T10:00:00.000Z",
      completedAt: "2026-05-14T12:00:00.000Z",
    }));

    const out = analyzeUserActivityPatterns({ tasks, agentRuns: runs, now });

    expect(out.agentSignals.totalRecommendations).toBe(3);
    expect(out.agentSignals.acceptedRecommendations).toBe(2);
    expect(out.agentSignals.acceptanceRate).toBe(0.6667);
    const tue = out.weekdayStats.find((r) => r.weekday === "Tuesday");
    expect(tue?.agentRecommendationsAccepted).toBe(1);
  });

  test("handles missing optional data without crashing", () => {
    const tasks = [{ id: "1", status: "todo" }];
    expect(() =>
      analyzeUserActivityPatterns({
        tasks,
        focusSessions: undefined,
        goals: undefined,
        agentRuns: undefined,
        streaks: undefined,
        now,
      })
    ).not.toThrow();

    const out = analyzeUserActivityPatterns({
      tasks,
      focusSessions: null,
      goals: null,
      agentRuns: null,
      streaks: { notANumber: "x" },
      now,
    });
    expect(out.consistencySignals.currentStreak).toBe(0);
    expect(out.weekdayStats.every((r) => typeof r.weekday === "string")).toBe(true);
  });
});
