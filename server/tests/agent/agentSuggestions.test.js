const {
  generateAgentSuggestions,
  buildBehaviorMismatchSuggestion,
  buildFocusDropoffSuggestion,
} = require("../../src/lib/agentSuggestionEngine");

const NOW = new Date("2026-06-03T12:00:00Z");

function daysAgo(n, from = NOW) {
  return new Date(from.getTime() - n * 24 * 60 * 60 * 1000);
}

function goalFixture(id, title, deadlineDaysAhead = 10) {
  return {
    id,
    title,
    deadline: daysAgo(-deadlineDaysAhead),
    availableDays: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
    maxUnitsPerDay: 2,
    totalUnits: 20,
    unitName: "chapter",
    userId: "user_1",
    createdAt: daysAgo(30),
  };
}

function tasksOnWeakDays(goalId, count = 5) {
  const mondayDates = [
    "2026-06-01T12:00:00Z",
    "2026-05-25T12:00:00Z",
    "2026-06-02T12:00:00Z",
    "2026-05-26T12:00:00Z",
    "2026-05-19T12:00:00Z",
  ];
  return mondayDates.slice(0, count).map((iso, i) => ({
    id: `task_${goalId}_${i}`,
    title: "Study",
    status: "todo",
    dueDate: new Date(iso),
    goalId,
    userId: "user_1",
  }));
}

describe("generateAgentSuggestions", () => {
  it("returns no suggestions when user is on track", () => {
    const goal = goalFixture("g1", "Calm Goal");
    const { suggestions } = generateAgentSuggestions({
      tasks: [
        {
          id: "t1",
          status: "todo",
          dueDate: daysAgo(-2),
          goalId: goal.id,
        },
      ],
      goals: [goal],
      goalAgentResults: [
        {
          goal,
          agentResult: {
            evaluation: { behindSchedule: false },
            failureAnalysis: { failureModes: [] },
            rebalanceRecommendation: { canRebalance: true },
          },
        },
      ],
      behavior: { dataQuality: { hasEnoughData: false, confidence: 0 } },
      focusSessions: [],
      now: NOW,
    });
    expect(suggestions).toHaveLength(0);
  });

  it("surfaces overdue task suggestion", () => {
    const { suggestions } = generateAgentSuggestions({
      tasks: [
        { id: "t1", status: "todo", dueDate: daysAgo(2), goalId: null },
        { id: "t2", status: "doing", dueDate: daysAgo(1), goalId: null },
        { id: "t3", status: "done", dueDate: daysAgo(3), goalId: null },
      ],
      goals: [],
      goalAgentResults: [],
      now: NOW,
    });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].type).toBe("overdue_tasks");
    expect(suggestions[0].severity).toBe("medium");
    expect(suggestions[0].recommendedAction).toBe("reschedule_tasks");
    expect(suggestions[0].requiresConfirmation).toBe(true);
  });

  it("surfaces behind schedule goal suggestion", () => {
    const goal = goalFixture("g_js", "JavaScript");
    const { suggestions } = generateAgentSuggestions({
      tasks: [],
      goals: [goal],
      goalAgentResults: [
        {
          goal,
          agentResult: {
            evaluation: {
              behindSchedule: true,
              status: "slightly_behind",
              missedTasks: 1,
            },
            failureAnalysis: { failureModes: [] },
            rebalanceRecommendation: { canRebalance: true },
          },
        },
      ],
      now: NOW,
    });
    expect(suggestions.some((s) => s.type === "goal_behind_schedule")).toBe(true);
    const hit = suggestions.find((s) => s.type === "goal_behind_schedule");
    expect(hit.relatedGoalId).toBe(goal.id);
    expect(hit.recommendedAction).toBe("preview_rebalance");
  });

  it("surfaces impossible goal suggestion", () => {
    const goal = goalFixture("g_tight", "Anatomy", 3);
    const { suggestions } = generateAgentSuggestions({
      tasks: [],
      goals: [goal],
      goalAgentResults: [
        {
          goal,
          agentResult: {
            evaluation: { behindSchedule: true, status: "at_risk" },
            failureAnalysis: { failureModes: [] },
            rebalanceRecommendation: {
              canRebalance: false,
              recommendedAction: "extend_deadline",
              reason: "remaining_units_exceed_capacity",
            },
          },
        },
      ],
      now: NOW,
    });
    const hit = suggestions.find((s) => s.type === "impossible_goal");
    expect(hit).toBeDefined();
    expect(hit.recommendedAction).toBe("extend_deadline");
    expect(suggestions.some((s) => s.type === "goal_behind_schedule")).toBe(false);
  });

  it("surfaces overloaded day suggestion", () => {
    const goal = goalFixture("g_load", "Physics");
    const { suggestions } = generateAgentSuggestions({
      tasks: [],
      goals: [goal],
      goalAgentResults: [
        {
          goal,
          agentResult: {
            evaluation: { behindSchedule: false },
            failureAnalysis: { failureModes: ["overloaded_day"] },
            rebalanceRecommendation: { canRebalance: true },
          },
        },
      ],
      now: NOW,
    });
    const hit = suggestions.find((s) => s.type === "overloaded_day");
    expect(hit).toBeDefined();
    expect(hit.recommendedAction).toBe("preview_rebalance");
  });

  it("creates behavior mismatch only with enough data", () => {
    const goal = goalFixture("g_rhythm", "Weekday Plan");
    const weakTasks = tasksOnWeakDays(goal.id, 5);
    const richBehavior = {
      dataQuality: { hasEnoughData: true, confidence: 0.7 },
      productivityPatterns: {
        strongestDays: ["SAT", "SUN"],
        weakestDays: ["MON", "TUE"],
      },
    };
    const poorBehavior = {
      dataQuality: { hasEnoughData: false, confidence: 0.2 },
      productivityPatterns: {
        strongestDays: ["SAT", "SUN"],
        weakestDays: ["MON", "TUE"],
      },
    };

    const withData = generateAgentSuggestions({
      tasks: weakTasks,
      goals: [goal],
      goalAgentResults: [
        {
          goal,
          agentResult: {
            evaluation: { behindSchedule: false },
            failureAnalysis: { failureModes: [] },
            rebalanceRecommendation: {},
          },
        },
      ],
      behavior: richBehavior,
      now: NOW,
    });
    expect(withData.suggestions.some((s) => s.type === "behavior_mismatch")).toBe(
      true
    );

    const withoutData = generateAgentSuggestions({
      tasks: weakTasks,
      goals: [goal],
      goalAgentResults: [
        {
          goal,
          agentResult: {
            evaluation: { behindSchedule: false },
            failureAnalysis: { failureModes: [] },
            rebalanceRecommendation: {},
          },
        },
      ],
      behavior: poorBehavior,
      now: NOW,
    });
    expect(
      withoutData.suggestions.some((s) => s.type === "behavior_mismatch")
    ).toBe(false);
    expect(
      buildBehaviorMismatchSuggestion(goal, weakTasks, poorBehavior)
    ).toBeNull();
  });

  it("creates focus dropoff only with enough focus data", () => {
    const sparse = buildFocusDropoffSuggestion(
      [{ duration: 25, startedAt: daysAgo(1) }],
      NOW
    );
    expect(sparse).toBeNull();

    const recent = [];
    const prior = [];
    for (let i = 0; i < 4; i++) {
      recent.push({ duration: 5, startedAt: daysAgo(i + 1) });
      prior.push({ duration: 30, startedAt: daysAgo(i + 8) });
    }

    const dropoff = buildFocusDropoffSuggestion([...recent, ...prior], NOW);
    expect(dropoff).not.toBeNull();
    expect(dropoff.type).toBe("focus_dropoff");

    const { suggestions } = generateAgentSuggestions({
      tasks: [],
      goals: [],
      goalAgentResults: [],
      focusSessions: [...recent, ...prior],
      now: NOW,
    });
    expect(suggestions.some((s) => s.type === "focus_dropoff")).toBe(true);
  });

  it("returns at most 3 suggestions by default", () => {
    const goals = ["A", "B", "C", "D"].map((title, i) =>
      goalFixture(`g_${i}`, title)
    );
    const { suggestions } = generateAgentSuggestions({
      tasks: [
        { id: "o1", status: "todo", dueDate: daysAgo(1), goalId: null },
        { id: "o2", status: "todo", dueDate: daysAgo(2), goalId: null },
      ],
      goals,
      goalAgentResults: goals.map((goal) => ({
        goal,
        agentResult: {
          evaluation: { behindSchedule: true, status: "at_risk", missedTasks: 2 },
          failureAnalysis: { failureModes: ["overloaded_day"] },
          rebalanceRecommendation: { canRebalance: true },
        },
      })),
      now: NOW,
      limit: 3,
    });
    expect(suggestions.length).toBeLessThanOrEqual(3);
  });

  it("ranks higher-severity suggestions first", () => {
    const tight = goalFixture("g_tight", "Tight Goal", 2);
    const calm = goalFixture("g_calm", "Calm Goal", 30);
    const { suggestions } = generateAgentSuggestions({
      tasks: [{ id: "o1", status: "todo", dueDate: daysAgo(1), goalId: null }],
      goals: [tight, calm],
      goalAgentResults: [
        {
          goal: tight,
          agentResult: {
            evaluation: { behindSchedule: true, status: "at_risk", missedTasks: 4 },
            failureAnalysis: { failureModes: [] },
            rebalanceRecommendation: {
              canRebalance: false,
              recommendedAction: "reduce_scope",
            },
          },
        },
        {
          goal: calm,
          agentResult: {
            evaluation: { behindSchedule: false },
            failureAnalysis: { failureModes: ["overloaded_day"] },
            rebalanceRecommendation: { canRebalance: true },
          },
        },
      ],
      now: NOW,
    });
    expect(suggestions.length).toBeGreaterThan(1);
    const severities = suggestions.map((s) => s.severity);
    const weight = { high: 3, medium: 2, low: 1 };
    for (let i = 1; i < severities.length; i++) {
      expect(weight[severities[i - 1]]).toBeGreaterThanOrEqual(weight[severities[i]]);
    }
    expect(suggestions[0].type).toBe("impossible_goal");
  });
});
