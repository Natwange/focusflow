const { detectFailureModes } = require("../../src/lib/failureModeDetector");

function buildTask({ status = "todo", dueDate, unitStart, unitEnd }) {
  return { status, dueDate, unitStart, unitEnd };
}

describe("detectFailureModes", () => {
  const baseGoal = {
    deadline: "2026-05-10T00:00:00.000Z",
    availableDays: [1, 2, 3, 4, 5],
    maxTasksPerDay: 3,
  };

  test("detects overloaded_day when incomplete tasks exceed per-day threshold", () => {
    const tasks = [
      buildTask({ dueDate: "2026-05-06T00:00:00.000Z" }),
      buildTask({ dueDate: "2026-05-06T00:00:00.000Z" }),
      buildTask({ dueDate: "2026-05-06T00:00:00.000Z" }),
      buildTask({ dueDate: "2026-05-06T00:00:00.000Z" }),
    ];

    const out = detectFailureModes({
      goal: baseGoal,
      tasks,
      evaluation: { totalTasks: 4, missedTasks: 0, behindSchedule: false },
      now: new Date("2026-05-05T00:00:00.000Z"),
    });

    expect(out.failureModes).toContain("overloaded_day");
    expect(out.failureModes).not.toContain("no_failure_detected");
  });

  test("detects too_many_missed_tasks from missed count/ratio", () => {
    const tasks = [
      buildTask({ dueDate: "2026-05-01T00:00:00.000Z" }),
      buildTask({ dueDate: "2026-05-02T00:00:00.000Z" }),
      buildTask({ dueDate: "2026-05-03T00:00:00.000Z" }),
      buildTask({ dueDate: "2026-05-08T00:00:00.000Z" }),
    ];

    const out = detectFailureModes({
      goal: baseGoal,
      tasks,
      evaluation: { totalTasks: 4, missedTasks: 3, behindSchedule: false },
      now: new Date("2026-05-05T00:00:00.000Z"),
    });

    expect(out.failureModes).toContain("too_many_missed_tasks");
    expect(out.primaryFailureMode).toBe("too_many_missed_tasks");
    expect(out.severity).toBe("high");
  });

  test("detects behind_schedule from evaluation output", () => {
    const tasks = [
      buildTask({ dueDate: "2026-05-08T00:00:00.000Z", unitStart: 1, unitEnd: 2 }),
      buildTask({ dueDate: "2026-05-09T00:00:00.000Z", unitStart: 3, unitEnd: 4 }),
    ];

    const out = detectFailureModes({
      goal: baseGoal,
      tasks,
      evaluation: { totalTasks: 2, missedTasks: 0, behindSchedule: true },
      now: new Date("2026-05-05T00:00:00.000Z"),
    });

    expect(out.failureModes).toContain("behind_schedule");
  });

  test("detects not_enough_available_days when remaining units exceed future capacity", () => {
    const tasks = [
      buildTask({ dueDate: "2026-05-08T00:00:00.000Z", unitStart: 1, unitEnd: 4 }),
      buildTask({ dueDate: "2026-05-09T00:00:00.000Z", unitStart: 5, unitEnd: 8 }),
      buildTask({ dueDate: "2026-05-10T00:00:00.000Z", unitStart: 9, unitEnd: 12 }),
    ];

    const goal = {
      ...baseGoal,
      availableDays: [1], // Monday only
      maxTasksPerDay: 2,
    };

    const out = detectFailureModes({
      goal,
      tasks,
      evaluation: { totalTasks: 3, missedTasks: 0, behindSchedule: false },
      now: new Date("2026-05-05T00:00:00.000Z"),
    });

    expect(out.failureModes).toContain("not_enough_available_days");
    expect(out.severity).toBe("high");
  });

  test("detects task_distribution_problem for uneven future spread", () => {
    const tasks = [
      buildTask({ dueDate: "2026-05-06T00:00:00.000Z" }),
      buildTask({ dueDate: "2026-05-06T00:00:00.000Z" }),
      buildTask({ dueDate: "2026-05-06T00:00:00.000Z" }),
      buildTask({ dueDate: "2026-05-06T00:00:00.000Z" }),
      buildTask({ dueDate: "2026-05-06T00:00:00.000Z" }),
    ];

    const goal = {
      ...baseGoal,
      maxTasksPerDay: 4,
      availableDays: [1, 2, 3, 4, 5],
      deadline: "2026-05-09T00:00:00.000Z",
    };

    const out = detectFailureModes({
      goal,
      tasks,
      evaluation: { totalTasks: 5, missedTasks: 0, behindSchedule: false },
      now: new Date("2026-05-05T00:00:00.000Z"),
    });

    expect(out.failureModes).toContain("task_distribution_problem");
  });

  test("returns no_failure_detected for clean case", () => {
    const tasks = [
      buildTask({ dueDate: "2026-05-06T00:00:00.000Z", status: "done", unitStart: 1, unitEnd: 1 }),
      buildTask({ dueDate: "2026-05-07T00:00:00.000Z", unitStart: 2, unitEnd: 2 }),
      buildTask({ dueDate: "2026-05-08T00:00:00.000Z", unitStart: 3, unitEnd: 3 }),
    ];

    const out = detectFailureModes({
      goal: baseGoal,
      tasks,
      evaluation: { totalTasks: 3, missedTasks: 0, behindSchedule: false },
      now: new Date("2026-05-05T00:00:00.000Z"),
    });

    expect(out.failureModes).toEqual(["no_failure_detected"]);
    expect(out.primaryFailureMode).toBe("no_failure_detected");
    expect(out.severity).toBe("low");
  });
});
