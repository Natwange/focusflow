const { buildPlan } = require("../../src/lib/buildPlan");

function unitsFromPlan(plan) {
  return plan.items.reduce((sum, it) => sum + it.unitsPlanned, 0);
}

function dayKey(isoString) {
  return new Date(isoString).toISOString().slice(0, 10);
}

describe("buildPlan()", () => {
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
});
