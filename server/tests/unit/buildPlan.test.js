const {
  buildPlan,
  PLAN_CAPACITY_ERROR,
  computeDeadlineRisk,
  AT_RISK_FRACTION,
} = require("../../src/lib/buildPlan");

function unitsFromPlan(plan) {
  return plan.items.reduce((sum, it) => sum + it.unitsPlanned, 0);
}

function dayKey(isoString) {
  return new Date(isoString).toISOString().slice(0, 10);
}

describe("buildPlan()", () => {
  test("schedules only on selected weekdays", () => {
    const plan = buildPlan({
      totalUnits: 6,
      unitName: "lesson",
      startDate: new Date("2026-05-04T00:00:00.000Z"), // Monday
      deadline: new Date("2026-05-10T00:00:00.000Z"), // Sunday
      availableDays: ["MON", "WED", "FRI"],
      weights: null,
    });

    const dueDayCodes = plan.items.map((it) => new Date(it.dueDate).getUTCDay());
    const allowed = new Set([1, 3, 5]); // Mon, Wed, Fri
    expect(dueDayCodes.every((d) => allowed.has(d))).toBe(true);
    expect(unitsFromPlan(plan)).toBe(6);
  });

  test("defaults to all days when availableDays is missing", () => {
    const plan = buildPlan({
      totalUnits: 4,
      unitName: "chapter",
      startDate: new Date("2026-05-01T00:00:00.000Z"),
      deadline: new Date("2026-05-04T00:00:00.000Z"),
      weights: null,
    });

    expect(plan.days).toBe(4);
    expect(unitsFromPlan(plan)).toBe(4);
  });

  test("respects maxUnitsPerDay on each planned day", () => {
    const plan = buildPlan({
      totalUnits: 8,
      unitName: "lesson",
      startDate: new Date("2026-05-01T00:00:00.000Z"),
      deadline: new Date("2026-05-04T00:00:00.000Z"),
      maxUnitsPerDay: 2,
      weights: null,
    });

    expect(unitsFromPlan(plan)).toBe(8);
    expect(plan.items.every((it) => it.unitsPlanned <= 2)).toBe(true);
  });

  test("maxUnitsPerDay: errors when total capacity is insufficient", () => {
    expect(() =>
      buildPlan({
        totalUnits: 10,
        unitName: "lesson",
        startDate: new Date("2026-05-01T00:00:00.000Z"),
        deadline: new Date("2026-05-03T00:00:00.000Z"),
        maxUnitsPerDay: 3,
        weights: null,
      })
    ).toThrow(PLAN_CAPACITY_ERROR);
  });

  test("maxUnitsPerDay: still sums to totalUnits when feasible", () => {
    const plan = buildPlan({
      totalUnits: 12,
      unitName: "chapter",
      startDate: new Date("2026-05-01T00:00:00.000Z"),
      deadline: new Date("2026-05-06T00:00:00.000Z"),
      maxUnitsPerDay: 3,
      weights: null,
    });
    expect(unitsFromPlan(plan)).toBe(12);
  });

  test("returns clear error when no eligible days exist", () => {
    expect(() =>
      buildPlan({
        totalUnits: 3,
        unitName: "unit",
        startDate: new Date("2026-05-05T00:00:00.000Z"), // Tue
        deadline: new Date("2026-05-06T00:00:00.000Z"), // Wed
        availableDays: ["MON"],
        weights: null,
      })
    ).toThrow(/no eligible study days/i);
  });

  test("basic distribution spreads units and preserves total", () => {
    const plan = buildPlan({
      totalUnits: 10,
      unitName: "lesson",
      startDate: new Date("2026-05-01T00:00:00.000Z"),
      deadline: new Date("2026-05-05T00:00:00.000Z"),
      weights: null,
    });

    expect(plan.days).toBe(5);
    expect(unitsFromPlan(plan)).toBe(10);
    expect(plan.items.length).toBeGreaterThan(1);
  });

  test("deadline alignment: last unit lands on deadline date", () => {
    const deadline = new Date("2026-05-07T00:00:00.000Z");
    const plan = buildPlan({
      totalUnits: 8,
      unitName: "chapter",
      startDate: new Date("2026-05-01T00:00:00.000Z"),
      deadline,
      weights: null,
    });

    const lastItem = plan.items[plan.items.length - 1];
    expect(dayKey(lastItem.dueDate)).toBe(dayKey(deadline.toISOString()));
    expect(lastItem.unitRange.end).toBe(8);
  });

  test("edge case (days < units): supports multiple units per day", () => {
    const plan = buildPlan({
      totalUnits: 10,
      unitName: "unit",
      startDate: new Date("2026-05-01T00:00:00.000Z"),
      deadline: new Date("2026-05-03T00:00:00.000Z"), // 3 days
      weights: null,
    });

    expect(plan.days).toBe(3);
    expect(unitsFromPlan(plan)).toBe(10);
    expect(plan.items.some((it) => it.unitsPlanned > 1)).toBe(true);
  });

  test("edge case (days > units): some days have zero assigned units", () => {
    const start = new Date("2026-05-01T00:00:00.000Z");
    const deadline = new Date("2026-05-10T00:00:00.000Z"); // 10 days
    const plan = buildPlan({
      totalUnits: 3,
      unitName: "chapter",
      startDate: start,
      deadline,
      weights: null,
    });

    const allDays = [];
    for (let i = 0; i < 10; i += 1) {
      const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
      allDays.push(dayKey(d.toISOString()));
    }
    const usedDays = new Set(plan.items.map((it) => dayKey(it.dueDate)));
    const zeroDays = allDays.filter((d) => !usedDays.has(d));

    expect(unitsFromPlan(plan)).toBe(3);
    expect(zeroDays.length).toBeGreaterThan(0);
  });

  test("consistency: same input yields identical output", () => {
    const input = {
      totalUnits: 12,
      unitName: "lesson",
      startDate: new Date("2026-05-01T00:00:00.000Z"),
      deadline: new Date("2026-05-06T00:00:00.000Z"),
      weights: [1, 2, 1, 1, 3, 1, 1, 1, 1, 2, 1, 1],
      unitStartAt: 1,
    };

    const a = buildPlan(input);
    const b = buildPlan(input);
    expect(a).toEqual(b);
  });

  test("invalid input: negative units throws", () => {
    expect(() =>
      buildPlan({
        totalUnits: -5,
        unitName: "lesson",
        startDate: new Date("2026-05-01T00:00:00.000Z"),
        deadline: new Date("2026-05-05T00:00:00.000Z"),
      })
    ).toThrow(/total units/i);
  });

  test("invalid input: invalid dates throw", () => {
    expect(() =>
      buildPlan({
        totalUnits: 5,
        unitName: "lesson",
        startDate: new Date("not-a-date"),
        deadline: new Date("2026-05-05T00:00:00.000Z"),
      })
    ).toThrow(/invalid date/i);
  });

  test("includes deadline risk fields", () => {
    const plan = buildPlan({
      totalUnits: 10,
      unitName: "lesson",
      startDate: new Date("2026-05-01T00:00:00.000Z"),
      deadline: new Date("2026-05-05T00:00:00.000Z"),
      maxUnitsPerDay: 5,
      weights: null,
    });
    expect(plan.riskLevel).toBe("on_track");
    expect(plan.eligibleDays).toBe(plan.days);
    expect(plan.requiredUnitsPerDay).toBeCloseTo(2, 5);
    expect(plan.perDay).toBe(plan.requiredUnitsPerDay);
  });
});

describe("computeDeadlineRisk()", () => {
  test("no max: always on_track, still reports requiredUnitsPerDay and eligibleDays", () => {
    const r = computeDeadlineRisk(10, 4, null);
    expect(r.riskLevel).toBe("on_track");
    expect(r.requiredUnitsPerDay).toBe(2.5);
    expect(r.eligibleDays).toBe(4);
  });

  test("on_track when required is below 80% of max", () => {
    const r = computeDeadlineRisk(79, 10, 10);
    expect(r.requiredUnitsPerDay).toBe(7.9);
    expect(7.9 < AT_RISK_FRACTION * 10).toBe(true);
    expect(r.riskLevel).toBe("on_track");
  });

  test("at_risk at exact 80% boundary (required >= 0.8 * max)", () => {
    const r = computeDeadlineRisk(80, 10, 10);
    expect(r.requiredUnitsPerDay).toBe(8);
    expect(r.requiredUnitsPerDay).toBe(AT_RISK_FRACTION * 10);
    expect(r.riskLevel).toBe("at_risk");
  });

  test("at_risk when required is between 80% and 100% of max", () => {
    const r = computeDeadlineRisk(95, 10, 10);
    expect(r.requiredUnitsPerDay).toBe(9.5);
    expect(r.riskLevel).toBe("at_risk");
  });

  test("at_risk when required equals max", () => {
    const r = computeDeadlineRisk(50, 10, 5);
    expect(r.requiredUnitsPerDay).toBe(5);
    expect(r.riskLevel).toBe("at_risk");
  });

  test("impossible when required exceeds max", () => {
    const r = computeDeadlineRisk(11, 2, 5);
    expect(r.requiredUnitsPerDay).toBe(5.5);
    expect(r.riskLevel).toBe("impossible");
  });

  test("impossible boundary: just above max", () => {
    const r = computeDeadlineRisk(21, 10, 2);
    expect(r.requiredUnitsPerDay).toBe(2.1);
    expect(r.riskLevel).toBe("impossible");
  });

  test("on_track boundary: just below 80% of max", () => {
    const max = 10;
    const days = 100;
    const total = Math.floor(AT_RISK_FRACTION * max * days) - 1;
    const r = computeDeadlineRisk(total, days, max);
    expect(r.requiredUnitsPerDay).toBe(total / days);
    expect(r.requiredUnitsPerDay < AT_RISK_FRACTION * max).toBe(true);
    expect(r.riskLevel).toBe("on_track");
  });
});
