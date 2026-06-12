function mockGetTestDb() {
  if (!global.__ffOutcomeDb) {
    global.__ffOutcomeDb = {
      goals: new Map(),
      tasks: [],
      agentRuns: [],
    };
  }
  return global.__ffOutcomeDb;
}

jest.mock("../../src/lib/prisma", () => {
  if (!global.__ffOutcomeDb) {
    global.__ffOutcomeDb = {
      goals: new Map(),
      tasks: [],
      agentRuns: [],
    };
  }
  const db = global.__ffOutcomeDb;
  return {
    goal: {
      findMany: jest.fn(async ({ where, select }) => {
        const rows = [...db.goals.values()].filter((g) => {
          if (where.userId && g.userId !== where.userId) return false;
          if (where.id?.in && !where.id.in.includes(g.id)) return false;
          return true;
        });
        if (!select) return rows.map((r) => ({ ...r }));
        return rows.map((row) => {
          const out = {};
          for (const key of Object.keys(select)) {
            if (select[key]) out[key] = row[key];
          }
          return out;
        });
      }),
    },
    task: {
      findMany: jest.fn(async ({ where, select }) => {
        const rows = db.tasks.filter((t) => {
          if (where.userId && t.userId !== where.userId) return false;
          if (where.goalId?.in && !where.goalId.in.includes(t.goalId)) return false;
          return true;
        });
        if (!select) return rows.map((r) => ({ ...r }));
        return rows.map((row) => {
          const out = {};
          for (const key of Object.keys(select)) {
            if (select[key]) out[key] = row[key];
          }
          return out;
        });
      }),
    },
    agentRun: {
      findMany: jest.fn(async ({ where, orderBy, select }) => {
        let rows = db.agentRuns.filter((r) => {
          if (where.userId && r.userId !== where.userId) return false;
          if (where.acceptedByUser === true && !r.acceptedByUser) return false;
          if (where.outcomeCheckedAt === null && r.outcomeCheckedAt != null) {
            return false;
          }
          if (where.createdAt?.gte && r.createdAt < where.createdAt.gte) return false;
          if (where.createdAt?.lte && r.createdAt > where.createdAt.lte) return false;
          return true;
        });
        if (orderBy?.createdAt === "asc") {
          rows = [...rows].sort((a, b) => a.createdAt - b.createdAt);
        }
        if (!select) return rows.map((r) => ({ ...r }));
        return rows.map((row) => {
          const out = {};
          for (const key of Object.keys(select)) {
            if (select[key]) out[key] = row[key];
          }
          return out;
        });
      }),
      update: jest.fn(async ({ where, data }) => {
        const idx = db.agentRuns.findIndex((r) => r.id === where.id);
        if (idx < 0) throw new Error("AgentRun not found");
        db.agentRuns[idx] = { ...db.agentRuns[idx], ...data };
        return db.agentRuns[idx];
      }),
    },
  };
});

const {
  evaluateAgentOutcome,
  evaluateOutcomesForUser,
  OUTCOME_STATUS,
  MIN_EVAL_HOURS,
} = require("../../src/lib/agentOutcomeEvaluator");
const { aggregateStrategyStats } = require("../../src/lib/agentStrategyStats");
const { executeTool } = require("../../src/agent/toolExecutor");

const NOW = new Date("2026-06-10T12:00:00Z");
const RUN_AT = new Date(NOW.getTime() - (MIN_EVAL_HOURS + 2) * 60 * 60 * 1000);

const goal = {
  id: "goal_1",
  userId: "user_1",
  title: "JavaScript",
  deadline: new Date("2026-07-01T12:00:00Z"),
  totalUnits: 10,
  createdAt: new Date("2026-05-01T12:00:00Z"),
  availableDays: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
  maxUnitsPerDay: 2,
};

function runWithEval(before, afterTasks) {
  return evaluateAgentOutcome({
    agentRun: {
      id: "ar_1",
      createdAt: RUN_AT,
      evaluation: before,
    },
    goal,
    tasks: afterTasks,
    now: NOW,
  });
}

describe("evaluateAgentOutcome", () => {
  it("detects improved outcome", () => {
    const result = runWithEval(
      { completionRate: 0.2, missedTasks: 3 },
      [
        { status: "done", dueDate: new Date("2026-06-01"), unitStart: 1, unitEnd: 1, title: "1" },
        { status: "done", dueDate: new Date("2026-06-02"), unitStart: 2, unitEnd: 2, title: "2" },
        { status: "done", dueDate: new Date("2026-06-03"), unitStart: 3, unitEnd: 3, title: "3" },
        { status: "todo", dueDate: new Date("2026-06-15"), unitStart: 4, unitEnd: 4, title: "4" },
        { status: "todo", dueDate: new Date("2026-06-16"), unitStart: 5, unitEnd: 5, title: "5" },
      ]
    );
    expect(result.outcomeStatus).toBe(OUTCOME_STATUS.IMPROVED);
    expect(result.completionRateAfter).toBeGreaterThan(result.completionRateBefore);
    expect(result.missedTasksAfter).toBeLessThanOrEqual(result.missedTasksBefore);
    expect(result.effectivenessScore).toBeGreaterThan(0);
  });

  it("detects neutral outcome", () => {
    const tasks = [
      { status: "done", dueDate: new Date("2026-06-01"), unitStart: 1, unitEnd: 1, title: "1" },
      { status: "done", dueDate: new Date("2026-06-02"), unitStart: 2, unitEnd: 2, title: "2" },
      { status: "todo", dueDate: new Date("2026-06-20"), unitStart: 3, unitEnd: 3, title: "3" },
      { status: "todo", dueDate: new Date("2026-06-21"), unitStart: 4, unitEnd: 4, title: "4" },
      { status: "todo", dueDate: new Date("2026-06-22"), unitStart: 5, unitEnd: 5, title: "5" },
    ];
    const result = runWithEval({ completionRate: 0.4, missedTasks: 0 }, tasks);
    expect(result.outcomeStatus).toBe(OUTCOME_STATUS.NEUTRAL);
  });

  it("detects worsened outcome", () => {
    const result = runWithEval(
      { completionRate: 0.5, missedTasks: 0 },
      [
        { status: "done", dueDate: new Date("2026-06-01"), unitStart: 1, unitEnd: 1, title: "1" },
        { status: "todo", dueDate: new Date("2026-06-01"), unitStart: 2, unitEnd: 2, title: "2" },
        { status: "todo", dueDate: new Date("2026-06-02"), unitStart: 3, unitEnd: 3, title: "3" },
        { status: "todo", dueDate: new Date("2026-06-03"), unitStart: 4, unitEnd: 4, title: "4" },
      ]
    );
    expect(result.outcomeStatus).toBe(OUTCOME_STATUS.WORSENED);
    expect(result.missedTasksAfter).toBeGreaterThan(result.missedTasksBefore);
  });

  it("returns insufficient_data when too little time has passed", () => {
    const result = evaluateAgentOutcome({
      agentRun: {
        id: "ar_new",
        createdAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000),
        evaluation: { completionRate: 0.2, missedTasks: 2 },
      },
      goal,
      tasks: [],
      now: NOW,
    });
    expect(result.outcomeStatus).toBe(OUTCOME_STATUS.INSUFFICIENT_DATA);
    expect(result.shouldPersist).toBe(false);
  });
});

describe("aggregateStrategyStats", () => {
  it("aggregates strategy stats correctly", () => {
    const payload = aggregateStrategyStats(
      [
        {
          nextAction: "rebalance",
          acceptedByUser: true,
          outcomeStatus: "improved",
          effectivenessScore: 12,
        },
        {
          nextAction: "rebalance",
          acceptedByUser: true,
          outcomeStatus: "improved",
          effectivenessScore: 8,
        },
        {
          nextAction: "rebalance",
          acceptedByUser: true,
          outcomeStatus: "worsened",
          effectivenessScore: -4,
        },
        {
          nextAction: "rebalance",
          acceptedByUser: false,
          outcomeStatus: null,
          effectivenessScore: null,
        },
        {
          nextAction: "keep_plan",
          acceptedByUser: true,
          outcomeStatus: "neutral",
          effectivenessScore: 0.5,
        },
      ],
      { lookbackDays: 90 }
    );

    const rebalance = payload.strategyStats.find((s) => s.strategy === "rebalance");
    expect(rebalance.timesSuggested).toBe(4);
    expect(rebalance.timesAccepted).toBe(3);
    expect(rebalance.evaluatedOutcomes).toBe(3);
    expect(rebalance.successRate).toBeCloseTo(2 / 3, 2);
    expect(rebalance.averageEffectivenessScore).toBeCloseTo(5.3333, 2);
    expect(payload.hasEnoughData).toBe(true);
  });
});

describe("evaluateOutcomesForUser integration", () => {
  const ctx = { userId: "user_1", tzOffsetMinutes: 0 };

  beforeEach(() => {
    jest.clearAllMocks();
    const db = mockGetTestDb();
    db.goals.clear();
    db.tasks = [];
    db.agentRuns = [];
    db.goals.set(goal.id, goal);
  });

  it("only evaluates accepted AgentRuns", async () => {
    const db = mockGetTestDb();
    db.agentRuns.push(
      {
        id: "ar_skip",
        userId: "user_1",
        goalId: goal.id,
        acceptedByUser: false,
        createdAt: RUN_AT,
        evaluation: { completionRate: 0.1, missedTasks: 4 },
        nextAction: "rebalance",
        outcomeCheckedAt: null,
      },
      {
        id: "ar_eval",
        userId: "user_1",
        goalId: goal.id,
        acceptedByUser: true,
        createdAt: RUN_AT,
        evaluation: { completionRate: 0.2, missedTasks: 2 },
        nextAction: "rebalance",
        outcomeCheckedAt: null,
      }
    );
    db.tasks.push(
      {
        userId: "user_1",
        goalId: goal.id,
        status: "done",
        dueDate: new Date("2026-06-01"),
        unitStart: 1,
        unitEnd: 1,
        title: "1",
      },
      {
        userId: "user_1",
        goalId: goal.id,
        status: "done",
        dueDate: new Date("2026-06-02"),
        unitStart: 2,
        unitEnd: 2,
        title: "2",
      },
      {
        userId: "user_1",
        goalId: goal.id,
        status: "done",
        dueDate: new Date("2026-06-03"),
        unitStart: 3,
        unitEnd: 3,
        title: "3",
      },
      {
        userId: "user_1",
        goalId: goal.id,
        status: "todo",
        dueDate: new Date("2026-06-20"),
        unitStart: 4,
        unitEnd: 4,
        title: "4",
      }
    );

    const summary = await evaluateOutcomesForUser("user_1", { now: NOW });
    expect(summary.evaluatedCount).toBe(1);
    expect(db.agentRuns.find((r) => r.id === "ar_skip").outcomeCheckedAt).toBeNull();
    expect(db.agentRuns.find((r) => r.id === "ar_eval").outcomeStatus).toBe(
      OUTCOME_STATUS.IMPROVED
    );
  });

  it("excludes cross-user AgentRuns", async () => {
    const db = mockGetTestDb();
    db.agentRuns.push({
      id: "ar_other",
      userId: "user_2",
      goalId: goal.id,
      acceptedByUser: true,
      createdAt: RUN_AT,
      evaluation: { completionRate: 0.1, missedTasks: 5 },
      nextAction: "rebalance",
      outcomeCheckedAt: null,
    });

    const summary = await evaluateOutcomesForUser("user_1", { now: NOW });
    expect(summary.evaluatedCount).toBe(0);
  });
});

describe("outcome learning tools", () => {
  const ctx = { userId: "user_1", tzOffsetMinutes: 0 };

  beforeEach(() => {
    jest.clearAllMocks();
    const db = mockGetTestDb();
    db.goals.clear();
    db.tasks = [];
    db.agentRuns = [];
  });

  it("get_agent_strategy_memory returns low-data message safely", async () => {
    const result = await executeTool(ctx, "get_agent_strategy_memory", {});
    expect(result.ok).toBe(true);
    expect(result.data.hasEnoughData).toBe(false);
    expect(result.summary).toMatch(/do not have enough outcome history yet/i);
  });
});
