const { runGoalAgent } = require("../../src/lib/goalAgentOrchestrator");

describe("runGoalAgent", () => {
  test("returns orchestrated output with nextAction mirroring recommendation action", () => {
    const goal = {
      id: "goal_1",
      createdAt: "2026-05-01T00:00:00.000Z",
      deadline: "2026-05-10T00:00:00.000Z",
      availableDays: [1, 2, 3, 4, 5],
      maxUnitsPerDay: 3,
    };

    const tasks = [
      {
        id: "task_1",
        title: "Unit 1",
        status: "todo",
        dueDate: "2026-05-03T00:00:00.000Z",
        unitStart: 1,
        unitEnd: 1,
      },
      {
        id: "task_2",
        title: "Unit 2",
        status: "todo",
        dueDate: "2026-05-09T00:00:00.000Z",
        unitStart: 2,
        unitEnd: 2,
      },
    ];

    const out = runGoalAgent({
      goal,
      tasks,
      now: new Date("2026-05-05T00:00:00.000Z"),
    });

    expect(out.goalId).toBe("goal_1");
    expect(typeof out.agentRunId).toBe("string");
    expect(out.agentRunId.length).toBeGreaterThan(0);
    expect(out.evaluation).toBeDefined();
    expect(out.failureAnalysis).toBeDefined();
    expect(out.rebalanceRecommendation).toBeDefined();
    expect(out.nextAction).toBe(out.rebalanceRecommendation.recommendedAction);
    expect(typeof out.recommendation).toBe("string");
    expect(out.recommendation.length).toBeGreaterThan(0);
    expect(Array.isArray(out.recommendationSegments)).toBe(true);
    expect(out.recommendationSegments.some((s) => s.emphasis)).toBe(true);
  });

  test("returns keep_plan nextAction when no failure detected", () => {
    const goal = {
      id: "goal_2",
      createdAt: "2026-05-01T00:00:00.000Z",
      deadline: "2026-05-10T00:00:00.000Z",
      availableDays: [1, 2, 3, 4, 5],
      maxUnitsPerDay: 3,
    };

    const tasks = [
      {
        id: "done_1",
        title: "Unit 1",
        status: "done",
        dueDate: "2026-05-02T00:00:00.000Z",
        unitStart: 1,
        unitEnd: 1,
      },
    ];

    const out = runGoalAgent({
      goal,
      tasks,
      now: new Date("2026-05-05T00:00:00.000Z"),
    });

    expect(out.nextAction).toBe("keep_plan");
    expect(out.rebalanceRecommendation.recommendedAction).toBe("keep_plan");
  });
});
