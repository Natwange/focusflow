const { recommendRebalance } = require("../../src/lib/rebalanceRecommendationEngine");

function task({
  id,
  title = "Task",
  status = "todo",
  dueDate,
  unitStart = null,
  unitEnd = null,
}) {
  return { id, title, status, dueDate, unitStart, unitEnd };
}

describe("recommendRebalance", () => {
  const now = new Date("2026-05-05T00:00:00.000Z");
  const baseGoal = {
    deadline: "2026-05-10T00:00:00.000Z",
    availableDays: [1, 2, 3, 4, 5, 6, 0],
    maxUnitsPerDay: 3,
  };

  test("keep_plan when no failure detected", () => {
    const out = recommendRebalance({
      goal: baseGoal,
      tasks: [],
      evaluation: {},
      failureAnalysis: { failureModes: ["no_failure_detected"] },
      now,
    });

    expect(out.canRebalance).toBe(false);
    expect(out.recommendedAction).toBe("keep_plan");
    expect(out.proposedSchedule).toEqual([]);
  });

  test("missed task moves forward into future capacity", () => {
    const tasks = [
      task({
        id: "t1",
        title: "Unit 1",
        status: "todo",
        dueDate: "2026-05-03T00:00:00.000Z",
        unitStart: 1,
        unitEnd: 1,
      }), // missed
      task({
        id: "t2",
        title: "Unit 2",
        status: "todo",
        dueDate: "2026-05-09T00:00:00.000Z",
        unitStart: 2,
        unitEnd: 2,
      }),
    ];

    const out = recommendRebalance({
      goal: baseGoal,
      tasks,
      evaluation: {},
      failureAnalysis: { failureModes: ["behind_schedule"] },
      now,
    });

    expect(out.canRebalance).toBe(true);
    expect(out.recommendedAction).toBe("rebalance");
    expect(out.proposedSchedule).toHaveLength(2);
    const movedMissed = out.proposedSchedule.find((p) => p.taskId === "t1");
    const futureTask = out.proposedSchedule.find((p) => p.taskId === "t2");
    expect(movedMissed.newDueDate).toBe("2026-05-05T00:00:00.000Z");
    expect(futureTask.newDueDate).toBe("2026-05-09T00:00:00.000Z");
  });

  test("future task stays on original future date when possible", () => {
    const tasks = [
      task({
        id: "future-1",
        dueDate: "2026-05-09T00:00:00.000Z",
        unitStart: 1,
        unitEnd: 1,
      }),
    ];

    const out = recommendRebalance({
      goal: baseGoal,
      tasks,
      evaluation: {},
      failureAnalysis: { failureModes: ["behind_schedule"] },
      now,
    });

    expect(out.proposedSchedule).toHaveLength(1);
    expect(out.proposedSchedule[0].oldDueDate).toBe("2026-05-09T00:00:00.000Z");
    expect(out.proposedSchedule[0].newDueDate).toBe("2026-05-09T00:00:00.000Z");
  });

  test("completed tasks are not moved", () => {
    const tasks = [
      task({
        id: "done-1",
        status: "done",
        dueDate: "2026-05-02T00:00:00.000Z",
        unitStart: 1,
        unitEnd: 1,
      }),
      task({
        id: "todo-1",
        status: "todo",
        dueDate: "2026-05-07T00:00:00.000Z",
        unitStart: 2,
        unitEnd: 2,
      }),
    ];

    const out = recommendRebalance({
      goal: baseGoal,
      tasks,
      evaluation: {},
      failureAnalysis: { failureModes: ["behind_schedule"] },
      now,
    });

    expect(out.proposedSchedule.map((p) => p.taskId)).toEqual(["todo-1"]);
  });

  test("only availableDays are used", () => {
    const tasks = [
      task({
        id: "t1",
        dueDate: "2026-05-03T00:00:00.000Z",
        unitStart: 1,
        unitEnd: 1,
      }),
      task({
        id: "t2",
        dueDate: "2026-05-04T00:00:00.000Z",
        unitStart: 2,
        unitEnd: 2,
      }),
    ];

    const out = recommendRebalance({
      goal: {
        ...baseGoal,
        availableDays: [1, 3], // Monday + Wednesday
        maxUnitsPerDay: 2,
      },
      tasks,
      evaluation: {},
      failureAnalysis: { failureModes: ["task_distribution_problem"] },
      now,
    });

    const dates = out.proposedSchedule.map((p) => new Date(p.newDueDate).getUTCDay());
    expect(dates.every((d) => d === 1 || d === 3)).toBe(true);
  });

  test("impossible rebalance defaults to extend_deadline", () => {
    const tasks = [
      task({
        id: "t1",
        dueDate: "2026-05-03T00:00:00.000Z",
        unitStart: 1,
        unitEnd: 4,
      }),
      task({
        id: "t2",
        dueDate: "2026-05-04T00:00:00.000Z",
        unitStart: 5,
        unitEnd: 8,
      }),
    ];

    const out = recommendRebalance({
      goal: {
        ...baseGoal,
        availableDays: [1], // Monday only
        maxUnitsPerDay: 2,
      },
      tasks,
      evaluation: {},
      failureAnalysis: { failureModes: ["not_enough_available_days"] },
      now,
    });

    expect(out.canRebalance).toBe(false);
    expect(out.recommendedAction).toBe("extend_deadline");
    expect(out.reason).toMatch(/does not include enough available work days/i);
  });

  test("strictDeadline true recommends reduce_scope for impossible rebalance", () => {
    const tasks = [
      task({
        id: "t1",
        dueDate: "2026-05-03T00:00:00.000Z",
        unitStart: 1,
        unitEnd: 4,
      }),
      task({
        id: "t2",
        dueDate: "2026-05-04T00:00:00.000Z",
        unitStart: 5,
        unitEnd: 8,
      }),
    ];

    const out = recommendRebalance({
      goal: {
        ...baseGoal,
        strictDeadline: true,
        availableDays: [1],
        maxUnitsPerDay: 2,
      },
      tasks,
      evaluation: {},
      failureAnalysis: { failureModes: ["not_enough_available_days"] },
      now,
    });

    expect(out.canRebalance).toBe(false);
    expect(out.recommendedAction).toBe("reduce_scope");
  });

  test("future task only moves when capacity/distribution requires it", () => {
    const tasks = [
      task({
        id: "m1",
        dueDate: "2026-05-03T00:00:00.000Z",
        unitStart: 1,
        unitEnd: 1,
      }),
      task({
        id: "f1",
        dueDate: "2026-05-07T00:00:00.000Z",
        unitStart: 2,
        unitEnd: 2,
      }),
      task({
        id: "f2",
        dueDate: "2026-05-07T00:00:00.000Z",
        unitStart: 3,
        unitEnd: 3,
      }),
    ];

    const out = recommendRebalance({
      goal: {
        ...baseGoal,
        maxUnitsPerDay: 1,
      },
      tasks,
      evaluation: {},
      failureAnalysis: { failureModes: ["task_distribution_problem"] },
      now,
    });

    const f1 = out.proposedSchedule.find((p) => p.taskId === "f1");
    const f2 = out.proposedSchedule.find((p) => p.taskId === "f2");
    expect(f1.newDueDate !== f1.oldDueDate || f2.newDueDate !== f2.oldDueDate).toBe(true);
  });

  test("proposedSchedule includes unitStart/unitEnd", () => {
    const tasks = [
      task({
        id: "t1",
        dueDate: "2026-05-03T00:00:00.000Z",
        unitStart: 10,
        unitEnd: 12,
      }),
    ];

    const out = recommendRebalance({
      goal: baseGoal,
      tasks,
      evaluation: {},
      failureAnalysis: { failureModes: ["behind_schedule"] },
      now,
    });

    expect(out.proposedSchedule[0]).toMatchObject({
      taskId: "t1",
      unitStart: 10,
      unitEnd: 12,
    });
  });

  test("changes explain from/to movement", () => {
    const tasks = [
      task({
        id: "t1",
        dueDate: "2026-05-03T00:00:00.000Z",
        unitStart: 1,
        unitEnd: 1,
      }),
    ];

    const out = recommendRebalance({
      goal: baseGoal,
      tasks,
      evaluation: {},
      failureAnalysis: { failureModes: ["behind_schedule"] },
      now,
    });

    expect(out.changes).toHaveLength(1);
    expect(out.changes[0]).toMatchObject({
      taskId: "t1",
      from: "2026-05-03T00:00:00.000Z",
      to: "2026-05-05T00:00:00.000Z",
    });
    expect(typeof out.changes[0].reason).toBe("string");
    expect(out.changes[0].reason.length).toBeGreaterThan(0);
  });

  test("no future task is moved earlier unnecessarily", () => {
    const tasks = [
      task({
        id: "m1",
        dueDate: "2026-05-03T00:00:00.000Z",
        unitStart: 1,
        unitEnd: 1,
      }),
      task({
        id: "f1",
        dueDate: "2026-05-08T00:00:00.000Z",
        unitStart: 2,
        unitEnd: 2,
      }),
    ];

    const out = recommendRebalance({
      goal: {
        ...baseGoal,
        maxUnitsPerDay: 2,
      },
      tasks,
      evaluation: {},
      failureAnalysis: { failureModes: ["behind_schedule"] },
      now,
    });

    const future = out.proposedSchedule.find((p) => p.taskId === "f1");
    expect(new Date(future.newDueDate).getTime()).toBeGreaterThanOrEqual(
      new Date(future.oldDueDate).getTime()
    );
    expect(future.newDueDate).toBe(future.oldDueDate);
  });
});
