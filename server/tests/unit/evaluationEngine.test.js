const { evaluateGoalProgress } = require("../../src/lib/evaluationEngine");

describe("evaluateGoalProgress", () => {
  test("computes core counts and progress from metadata", () => {
    const goal = {
      createdAt: "2026-05-01T00:00:00.000Z",
      deadline: "2026-05-10T00:00:00.000Z",
    };

    const tasks = [
      {
        status: "done",
        dueDate: "2026-05-02T00:00:00.000Z",
        unitStart: 1,
        unitEnd: 2,
      },
      {
        status: "todo",
        dueDate: "2026-05-03T00:00:00.000Z",
        unitStart: 3,
        unitEnd: 4,
      },
      {
        status: "todo",
        dueDate: "2026-05-08T00:00:00.000Z",
        unitStart: 5,
        unitEnd: 6,
      },
    ];

    const out = evaluateGoalProgress({
      goal,
      tasks,
      now: new Date("2026-05-06T12:00:00.000Z"),
    });

    expect(out.totalTasks).toBe(3);
    expect(out.completedTasks).toBe(1);
    expect(out.remainingTasks).toBe(2);
    expect(out.missedTasks).toBe(1);
    expect(out.totalUnits).toBe(6);
    expect(out.completedUnits).toBe(2);
    expect(out.completionRate).toBeCloseTo(0.3333, 4);
    expect(out.expectedProgress).toBeCloseTo(0.5, 4);
    expect(out.actualProgress).toBeCloseTo(0.3333, 4);
    expect(out.behindSchedule).toBe(true);
    expect(out.status).toBe("slightly_behind");
  });

  test("infers units from task title when unit metadata is missing", () => {
    const goal = {
      createdAt: "2026-05-01T00:00:00.000Z",
      deadline: "2026-05-10T00:00:00.000Z",
    };

    const tasks = [
      { status: "done", dueDate: "2026-05-02T00:00:00.000Z", title: "Lessons 1-3" },
      { status: "done", dueDate: "2026-05-03T00:00:00.000Z", title: "Lessons 4-6" },
      { status: "todo", dueDate: "2026-05-08T00:00:00.000Z", title: "Lessons 7-9" },
    ];

    const out = evaluateGoalProgress({
      goal,
      tasks,
      now: new Date("2026-05-04T12:00:00.000Z"),
    });

    expect(out.totalUnits).toBe(9);
    expect(out.completedUnits).toBe(6);
    expect(out.completionRate).toBeCloseTo(6 / 9, 4);
  });

  test("uses safe fallback for legacy tasks missing unit metadata", () => {
    const goal = {
      createdAt: "2026-05-01T00:00:00.000Z",
      deadline: "2026-05-10T00:00:00.000Z",
    };

    const tasks = [
      { status: "done", dueDate: "2026-05-02T00:00:00.000Z" },
      { status: "todo", dueDate: "2026-05-03T00:00:00.000Z" },
    ];

    const out = evaluateGoalProgress({
      goal,
      tasks,
      now: new Date("2026-05-02T12:00:00.000Z"),
    });

    expect(out.totalUnits).toBe(2);
    expect(out.completedUnits).toBe(1);
    expect(out.completionRate).toBe(0.5);
  });

  test("returns on_track when actual progress keeps pace", () => {
    const goal = {
      createdAt: "2026-05-01T00:00:00.000Z",
      deadline: "2026-05-10T00:00:00.000Z",
    };

    const tasks = [
      { status: "done", unitStart: 1, unitEnd: 3, dueDate: "2026-05-03T00:00:00.000Z" },
      { status: "todo", unitStart: 4, unitEnd: 6, dueDate: "2026-05-09T00:00:00.000Z" },
    ];

    const out = evaluateGoalProgress({
      goal,
      tasks,
      now: new Date("2026-05-05T00:00:00.000Z"),
    });

    expect(out.behindSchedule).toBe(false);
    expect(out.status).toBe("on_track");
  });
});
