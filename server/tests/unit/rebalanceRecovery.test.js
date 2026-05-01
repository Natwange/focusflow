const { buildPlan } = require("../../src/lib/buildPlan");
const {
  computeExpectedUnitsByToday,
  buildRebalancePreview,
  earliestDeadlineFitting,
  parseTrailingUnitRange,
} = require("../../src/lib/rebalanceRecovery");

describe("parseTrailingUnitRange", () => {
  test("parses single and ranges", () => {
    expect(parseTrailingUnitRange("lessons 3")).toEqual({
      start: 3,
      end: 3,
      unitsPlanned: 1,
    });
    expect(parseTrailingUnitRange("lessons 3-5")).toEqual({
      start: 3,
      end: 5,
      unitsPlanned: 3,
    });
  });
});

describe("computeExpectedUnitsByToday", () => {
  test("linear interpolation by eligible days", () => {
    const planStart = new Date("2026-01-01T00:00:00.000Z");
    const deadline = new Date("2026-01-11T00:00:00.000Z"); // 11 eligible days (all week)
    const today = new Date("2026-01-06T00:00:00.000Z"); // day 6 of 11
    const ex = computeExpectedUnitsByToday({
      totalUnits: 110,
      planStart,
      today,
      deadline,
      availableDays: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
    });
    expect(ex).toBe(60);
  });
});

describe("buildRebalancePreview", () => {
  const baseGoal = {
    id: "g1",
    title: "Test",
    totalUnits: 100,
    unitName: "lesson",
    deadline: new Date("2026-12-31T00:00:00.000Z"),
    availableDays: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
    maxUnitsPerDay: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };

  test("not behind: no recovery options", () => {
    const today = new Date("2026-06-15T00:00:00.000Z");
    const r = buildRebalancePreview({
      goal: baseGoal,
      completedUnits: 100,
      today,
    });
    expect(r.isBehind).toBe(false);
    expect(r.options).toEqual([]);
    expect(r.remainingUnits).toBe(0);
  });

  test("not behind when ahead of schedule", () => {
    const today = new Date("2026-03-01T00:00:00.000Z");
    const r = buildRebalancePreview({
      goal: baseGoal,
      completedUnits: 40,
      today,
    });
    expect(r.isBehind).toBe(false);
    expect(r.options.length).toBe(0);
  });

  test("behind returns four strategy options", () => {
    const today = new Date("2026-10-01T00:00:00.000Z");
    const r = buildRebalancePreview({
      goal: baseGoal,
      completedUnits: 0,
      today,
    });
    expect(r.isBehind).toBe(true);
    expect(r.remainingUnits).toBe(100);
    expect(r.options.map((o) => o.strategy)).toEqual([
      "keep_deadline",
      "spread_evenly",
      "increase_daily_load",
      "extend_deadline",
    ]);
  });

  test("impossible keep_deadline yields extend_deadline feasible", () => {
    const goal = {
      ...baseGoal,
      totalUnits: 30,
      deadline: new Date("2026-05-05T00:00:00.000Z"),
      availableDays: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
      maxUnitsPerDay: 1,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    const today = new Date("2026-05-01T00:00:00.000Z");
    const r = buildRebalancePreview({
      goal,
      completedUnits: 0,
      today,
    });
    expect(r.isBehind).toBe(true);
    const keep = r.options.find((o) => o.strategy === "keep_deadline");
    const ext = r.options.find((o) => o.strategy === "extend_deadline");
    expect(keep.feasible).toBe(false);
    expect(ext.feasible).toBe(true);
    expect(ext.newDeadline).not.toBeNull();
    expect(new Date(ext.newDeadline).getTime()).toBeGreaterThan(
      new Date(goal.deadline).getTime()
    );
  });

  test("selected extend_deadline produces a valid plan", () => {
    const goal = {
      id: "g2",
      title: "Tight",
      totalUnits: 12,
      unitName: "u",
      deadline: new Date("2026-05-04T00:00:00.000Z"),
      availableDays: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
      maxUnitsPerDay: 1,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    const today = new Date("2026-05-01T00:00:00.000Z");
    const completedUnits = 0;
    const remainingUnits = 12;
    const r = buildRebalancePreview({ goal, completedUnits, today });
    const ext = r.options.find((o) => o.strategy === "extend_deadline");
    expect(ext.feasible).toBe(true);
    const newDeadline = new Date(ext.newDeadline);
    const plan = buildPlan({
      totalUnits: remainingUnits,
      unitName: goal.unitName,
      startDate: today,
      deadline: newDeadline,
      availableDays: goal.availableDays,
      maxUnitsPerDay: goal.maxUnitsPerDay,
      unitStartAt: completedUnits + 1,
      weights: null,
    });
    const sum = plan.items.reduce((s, it) => s + it.unitsPlanned, 0);
    expect(sum).toBe(12);
  });
});

describe("earliestDeadlineFitting", () => {
  test("finds first deadline with enough capacity under cap", () => {
    const today = new Date("2026-05-01T00:00:00.000Z");
    const initial = new Date("2026-05-03T00:00:00.000Z");
    const d = earliestDeadlineFitting({
      today,
      initialDeadline: initial,
      remainingUnits: 10,
      maxUnitsPerDay: 2,
      availableDays: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
    });
    expect(d).not.toBeNull();
    expect(d.getTime()).toBeGreaterThanOrEqual(initial.getTime());
  });
});
