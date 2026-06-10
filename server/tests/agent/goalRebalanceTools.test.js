function mockGetTestDb() {
  if (!global.__ffGoalRebalanceDb) {
    global.__ffGoalRebalanceDb = {
      users: new Map(),
      goals: new Map(),
      tasks: [],
      focusSessions: [],
      agentRuns: [],
    };
  }
  return global.__ffGoalRebalanceDb;
}

jest.mock("../../src/lib/prisma", () => {
  if (!global.__ffGoalRebalanceDb) {
    global.__ffGoalRebalanceDb = {
      users: new Map(),
      goals: new Map(),
      tasks: [],
      focusSessions: [],
      agentRuns: [],
    };
  }
  const db = global.__ffGoalRebalanceDb;
  return {
    user: {
      findUnique: jest.fn(async ({ where }) => db.users.get(where.id) || null),
    },
    goal: {
      findUnique: jest.fn(async ({ where, select }) => {
        const record = db.goals.get(where.id) || null;
        if (!record) return null;
        if (!select) return { ...record };
        const out = {};
        for (const key of Object.keys(select)) {
          if (select[key]) out[key] = record[key];
        }
        return out;
      }),
      findMany: jest.fn(async ({ where }) =>
        [...db.goals.values()].filter((g) => {
          if (where.userId && g.userId !== where.userId) return false;
          if (where.title) {
            if (typeof where.title === "string" && g.title !== where.title) return false;
            if (where.title.contains) {
              const search = where.title.contains.toLowerCase();
              if (!g.title.toLowerCase().includes(search)) return false;
            }
          }
          return true;
        })
      ),
      update: jest.fn(async ({ where, data }) => {
        const goal = db.goals.get(where.id);
        if (!goal) throw new Error("Goal not found");
        db.goals.set(where.id, { ...goal, ...data });
        return db.goals.get(where.id);
      }),
    },
    task: {
      findUnique: jest.fn(async ({ where }) =>
        db.tasks.find((t) => t.id === where.id) || null
      ),
      findMany: jest.fn(async ({ where, select }) => {
        const rows = db.tasks.filter((t) => {
          if (where.userId && t.userId !== where.userId) return false;
          if (where.goalId && t.goalId !== where.goalId) return false;
          if (where.goalId?.in && !where.goalId.in.includes(t.goalId)) return false;
          if (where.status && t.status !== where.status) return false;
          if (where.status?.not && t.status === where.status.not) return false;
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
      update: jest.fn(async ({ where, data, select }) => {
        const task = db.tasks.find((t) => t.id === where.id);
        if (!task) throw new Error("Not found");
        Object.assign(task, data);
        if (!select) return { ...task };
        const out = {};
        for (const key of Object.keys(select)) {
          if (select[key]) out[key] = task[key];
        }
        return out;
      }),
      deleteMany: jest.fn(async ({ where }) => {
        const before = db.tasks.length;
        db.tasks = db.tasks.filter((t) => {
          if (where.userId && t.userId !== where.userId) return true;
          if (where.goalId && t.goalId !== where.goalId) return true;
          if (where.status?.not && t.status === where.status.not) return true;
          return false;
        });
        return { count: before - db.tasks.length };
      }),
      create: jest.fn(async ({ data, select }) => {
        const row = {
          id: `task_${db.tasks.length + 1}`,
          status: "todo",
          ...data,
        };
        db.tasks.push(row);
        if (!select) return { ...row };
        const out = {};
        for (const key of Object.keys(select)) {
          if (select[key]) out[key] = row[key];
        }
        return out;
      }),
    },
    $transaction: jest.fn(async (ops) => {
      const results = [];
      for (const op of ops) results.push(await op);
      return results;
    }),
    focusSession: {
      findMany: jest.fn(async () => []),
    },
    agentRun: {
      create: jest.fn(async ({ data }) => {
        const row = {
          id: `ar_${db.agentRuns.length + 1}`,
          acceptedByUser: false,
          createdAt: new Date(),
          ...data,
        };
        db.agentRuns.push(row);
        return row;
      }),
      findFirst: jest.fn(async ({ where, orderBy }) => {
        const rows = db.agentRuns.filter(
          (r) => r.goalId === where.goalId && r.userId === where.userId
        );
        if (orderBy?.createdAt === "desc") {
          rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        return rows[0] || null;
      }),
      update: jest.fn(async ({ where, data }) => {
        const idx = db.agentRuns.findIndex((r) => r.id === where.id);
        if (idx < 0) throw new Error("AgentRun not found");
        db.agentRuns[idx] = { ...db.agentRuns[idx], ...data };
        return db.agentRuns[idx];
      }),
      findMany: jest.fn(async ({ where }) =>
        db.agentRuns.filter((r) => {
          if (where.userId && r.userId !== where.userId) return false;
          return true;
        })
      ),
    },
  };
});

const { executeTool } = require("../../src/agent/toolExecutor");
const {
  setCompleteAgentTurnForTests,
  setCompleteObserveRespondForTests,
  resetLlmClientForTests,
} = require("../../src/agent/llmClient");
const { runLlmTurn: runChatTurn } = require("../../src/agent/chatOrchestrator");
const { resolveGoal } = require("../../src/lib/goalResolver");

function seedRebalanceGoal(db, { goalId = "goal_1", userId = "user_1", title = "JavaScript Study" } = {}) {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  db.goals.set(goalId, {
    id: goalId,
    userId,
    title,
    totalUnits: 10,
    unitName: "lessons",
    createdAt: new Date(now - 10 * day),
    deadline: new Date(now + 10 * day),
    availableDays: [0, 1, 2, 3, 4, 5, 6],
    maxUnitsPerDay: 3,
  });
  db.tasks.push(
    {
      id: "task_missed",
      userId,
      goalId,
      title: "Missed unit",
      status: "todo",
      dueDate: new Date(now - 2 * day),
      unitStart: 1,
      unitEnd: 1,
    },
    {
      id: "task_future",
      userId,
      goalId,
      title: "Future unit",
      status: "todo",
      dueDate: new Date(now + 3 * day),
      unitStart: 2,
      unitEnd: 2,
    },
    {
      id: "task_done",
      userId,
      goalId,
      title: "Completed unit",
      status: "done",
      dueDate: new Date(now - 1 * day),
      unitStart: 3,
      unitEnd: 3,
    }
  );
}

function seedImpossibleGoal(db) {
  const now = new Date("2026-05-05T00:00:00.000Z").getTime();
  const day = 24 * 60 * 60 * 1000;
  db.goals.set("goal_impossible", {
    id: "goal_impossible",
    userId: "user_1",
    title: "Tight DSA",
    totalUnits: 8,
    unitName: "units",
    createdAt: new Date(now - 5 * day),
    deadline: new Date(now + 5 * day),
    availableDays: [1],
    maxUnitsPerDay: 2,
  });
  db.tasks.push(
    {
      id: "t1",
      userId: "user_1",
      goalId: "goal_impossible",
      title: "Units 1-4",
      status: "todo",
      dueDate: new Date("2026-05-03T00:00:00.000Z"),
      unitStart: 1,
      unitEnd: 4,
    },
    {
      id: "t2",
      userId: "user_1",
      goalId: "goal_impossible",
      title: "Units 5-8",
      status: "todo",
      dueDate: new Date("2026-05-04T00:00:00.000Z"),
      unitStart: 5,
      unitEnd: 8,
    }
  );
}

describe("goal rebalance agent tools", () => {
  const ctx = { userId: "user_1", tzOffsetMinutes: 0 };

  beforeEach(() => {
    jest.clearAllMocks();
    resetLlmClientForTests();
    const db = mockGetTestDb();
    db.users.clear();
    db.goals.clear();
    db.tasks = [];
    db.focusSessions = [];
    db.agentRuns = [];
    db.users.set("user_1", { id: "user_1", streakCount: 0, streakDateKey: "2026-05-01" });
  });

  test("1. list_goals returns only user goals", async () => {
    seedRebalanceGoal(mockGetTestDb(), { goalId: "goal_1", title: "DSA" });
    mockGetTestDb().goals.set("goal_other", {
      id: "goal_other",
      userId: "user_2",
      title: "Other user goal",
      totalUnits: 5,
      unitName: "units",
      deadline: new Date(),
      createdAt: new Date(),
      availableDays: ["MON"],
      maxUnitsPerDay: 2,
    });

    const result = await executeTool(ctx, "list_goals", { status: "all" });
    expect(result.ok).toBe(true);
    expect(result.data.count).toBe(1);
    expect(result.data.goals[0].goalId).toBe("goal_1");
  });

  test("2. get_goal_agent_preview returns evaluation and rebalance data", async () => {
    seedRebalanceGoal(mockGetTestDb());
    const result = await executeTool(ctx, "get_goal_agent_preview", {
      goalId: "goal_1",
    });

    expect(result.ok).toBe(true);
    expect(result.data.evaluation).toBeDefined();
    expect(result.data.failureAnalysis).toBeDefined();
    expect(result.data.rebalanceRecommendation).toBeDefined();
    expect(result.data.recommendation).toBeDefined();
    expect(result.data.nextAction).toBeDefined();
    expect(mockGetTestDb().agentRuns).toHaveLength(1);
    expect(mockGetTestDb().agentRuns[0].rebalancePreview._source).toBe("chat");
  });

  test("3. overwhelmed prompt with multiple goals asks clarification", async () => {
    const db = mockGetTestDb();
    seedRebalanceGoal(db, { goalId: "goal_1", title: "DSA" });
    seedRebalanceGoal(db, { goalId: "goal_2", title: "JavaScript" });

    setCompleteAgentTurnForTests(async () => ({
      type: "tool_call",
      toolName: "list_goals",
      rawArgs: { status: "active" },
    }));
    setCompleteObserveRespondForTests(async () => ({
      type: "message",
      content:
        "You have two active goals: DSA and JavaScript. Which one should I rebalance?",
    }));

    const res = await runChatTurn({
      userId: "user_1",
      message: "I'm overwhelmed today, help me fix my schedule",
      tzOffsetMinutes: 0,
    });

    expect(res.toolResults[0].tool).toBe("list_goals");
    expect(res.toolResults[0].result.data.count).toBe(2);
    expect(res.pendingConfirmation).toBeNull();
    expect(res.assistantMessage).toMatch(/which/i);
  });

  test("4. one active goal produces rebalance preview", async () => {
    seedRebalanceGoal(mockGetTestDb());
    const result = await executeTool(ctx, "get_goal_agent_preview", {
      goalId: "goal_1",
    });

    expect(result.ok).toBe(true);
    expect(result.data.rebalanceRecommendation.canRebalance).toBe(true);
    expect(result.data.pendingConfirmation).toMatchObject({
      type: "apply_goal_rebalance",
      goalId: "goal_1",
      goalTitle: "JavaScript Study",
    });
    expect(result.data.pendingConfirmation.changeCount).toBeGreaterThan(0);
  });

  test("5. apply_goal_rebalance without confirmed returns pendingConfirmation", async () => {
    seedRebalanceGoal(mockGetTestDb());
    const result = await executeTool(ctx, "apply_goal_rebalance", {
      goalId: "goal_1",
    });

    expect(result.ok).toBe(true);
    expect(result.data.pendingConfirmation).toMatchObject({
      type: "apply_goal_rebalance",
      goalId: "goal_1",
    });
  });

  test("6. confirmed apply updates only recommended tasks", async () => {
    const db = mockGetTestDb();
    seedRebalanceGoal(db);
    const beforeMissed = db.tasks.find((t) => t.id === "task_missed").dueDate.toISOString();

    const result = await executeTool(ctx, "apply_goal_rebalance", {
      goalId: "goal_1",
      confirmed: true,
    });

    expect(result.ok).toBe(true);
    expect(result.data.applied).toBe(true);
    expect(result.data.updatedTasks.length).toBeGreaterThan(0);
    const afterMissed = db.tasks.find((t) => t.id === "task_missed").dueDate.toISOString();
    expect(afterMissed).not.toBe(beforeMissed);
  });

  test("7. completed tasks are untouched", async () => {
    const db = mockGetTestDb();
    seedRebalanceGoal(db);
    const doneBefore = db.tasks.find((t) => t.id === "task_done").dueDate.toISOString();

    const result = await executeTool(ctx, "apply_goal_rebalance", {
      goalId: "goal_1",
      confirmed: true,
    });

    expect(result.ok).toBe(true);
    const doneAfter = db.tasks.find((t) => t.id === "task_done").dueDate.toISOString();
    expect(doneAfter).toBe(doneBefore);
    expect(result.data.updatedTasks.some((t) => t.id === "task_done")).toBe(false);
  });

  test("8. impossible rebalance explains extend_deadline or reduce_scope", async () => {
    seedImpossibleGoal(mockGetTestDb());
    const result = await executeTool(ctx, "get_goal_agent_preview", {
      goalId: "goal_impossible",
    });

    expect(result.ok).toBe(true);
    expect(result.data.rebalanceRecommendation.canRebalance).toBe(false);
    expect(["extend_deadline", "reduce_scope"]).toContain(result.data.nextAction);
    expect(result.data.pendingConfirmation).toBeUndefined();
  });

  test("9. cross-user goal access blocked", async () => {
    seedRebalanceGoal(mockGetTestDb(), { userId: "user_2", goalId: "goal_other" });

    const preview = await executeTool(ctx, "get_goal_agent_preview", {
      goalId: "goal_other",
    });
    expect(preview.ok).toBe(false);
    expect(preview.error).toMatch(/belong|Forbidden/i);

    const apply = await executeTool(ctx, "apply_goal_rebalance", {
      goalId: "goal_other",
      confirmed: true,
    });
    expect(apply.ok).toBe(false);
    expect(apply.error).toMatch(/belong|Forbidden/i);
  });

  test("10. behavior context is used only when data exists", async () => {
    const behavior = await executeTool(ctx, "get_user_behavior_context", {
      lookbackDays: 30,
    });
    expect(behavior.ok).toBe(true);
    expect(behavior.data.signals.dataQuality.hasEnoughData).toBe(false);
    expect(behavior.summary).toMatch(/insufficient history/i);

    seedRebalanceGoal(mockGetTestDb());
    const preview = await executeTool(ctx, "get_goal_agent_preview", {
      goalId: "goal_1",
    });
    expect(preview.ok).toBe(true);
    expect(preview.data.evaluation).toBeDefined();
  });

  test("goal title resolver matches JavaScript goal", async () => {
    seedRebalanceGoal(mockGetTestDb(), { title: "Learn JavaScript in 30 days" });
    const resolved = await resolveGoal("user_1", { goalTitle: "JavaScript" });
    expect(resolved.ok).toBe(true);
    expect(resolved.goal.id).toBe("goal_1");
  });

  test("list_tasks resolves invented slug goalId to real goal tasks", async () => {
    seedRebalanceGoal(mockGetTestDb(), {
      title: "Study Human Anatomy",
      goalId: "goal_anatomy",
    });

    const result = await executeTool(ctx, "list_tasks", {
      goalId: "study-human-anatomy",
    });

    expect(result.ok).toBe(true);
    expect(result.data.count).toBe(3);
    expect(result.data.goalId).toBe("goal_anatomy");
    expect(result.data.goalTitle).toBe("Study Human Anatomy");
    expect(result.summary).toMatch(/Study Human Anatomy/);
  });

  test("get_goal_agent_preview accepts goalTitle", async () => {
    seedRebalanceGoal(mockGetTestDb(), {
      title: "Study Human Anatomy",
      goalId: "goal_anatomy",
    });

    const result = await executeTool(ctx, "get_goal_agent_preview", {
      goalTitle: "human anatomy",
    });

    expect(result.ok).toBe(true);
    expect(result.data.goalId).toBe("goal_anatomy");
    expect(result.data.goalTitle).toBe("Study Human Anatomy");
    expect(result.data.evaluation).toBeDefined();
    expect(result.summary).toMatch(/Matched goal/i);
  });

  test("preview_goal_adjustment works when goal is on track", async () => {
    const db = mockGetTestDb();
    const deadline = new Date("2026-06-15T00:00:00.000Z");
    db.goals.set("goal_anatomy", {
      id: "goal_anatomy",
      userId: "user_1",
      title: "Learn Human Anatomy",
      totalUnits: 50,
      unitName: "lessons",
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      deadline,
      availableDays: [0, 1, 2, 3, 4, 5, 6],
      maxUnitsPerDay: 7,
    });
    for (let i = 0; i < 8; i += 1) {
      db.tasks.push({
        id: `anatomy_task_${i}`,
        userId: "user_1",
        goalId: "goal_anatomy",
        title: `lessons ${i * 7 + 1}-${(i + 1) * 7}`,
        status: "todo",
        dueDate: new Date(`2026-06-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`),
        unitStart: i * 7 + 1,
        unitEnd: (i + 1) * 7,
      });
    }

    const result = await executeTool(ctx, "preview_goal_adjustment", {
      goalTitle: "human anatomy",
      deadline: "2026-07-10",
      spreadEvenly: true,
    });

    expect(result.ok).toBe(true);
    expect(result.data.feasible).toBe(true);
    expect(result.data.items.length).toBeGreaterThan(0);
    expect(result.data.pendingConfirmation?.type).toBe("apply_goal_adjustment");
    expect(result.data.proposed.spreadEvenly).toBe(true);
    expect(result.data.proposed.estimatedAvgUnitsPerDay).toBeLessThan(7);
  });

  test("apply_goal_adjustment confirmed replans incomplete tasks only", async () => {
    const db = mockGetTestDb();
    db.goals.set("goal_anatomy", {
      id: "goal_anatomy",
      userId: "user_1",
      title: "Learn Human Anatomy",
      totalUnits: 20,
      unitName: "lessons",
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      deadline: new Date("2026-06-15T00:00:00.000Z"),
      availableDays: [0, 1, 2, 3, 4, 5, 6],
      maxUnitsPerDay: 5,
    });
    db.tasks.push(
      {
        id: "done_1",
        userId: "user_1",
        goalId: "goal_anatomy",
        title: "lessons 1-2",
        status: "done",
        dueDate: new Date("2026-05-10T00:00:00.000Z"),
        unitStart: 1,
        unitEnd: 2,
      },
      {
        id: "todo_1",
        userId: "user_1",
        goalId: "goal_anatomy",
        title: "lessons 3-10",
        status: "todo",
        dueDate: new Date("2026-06-01T00:00:00.000Z"),
        unitStart: 3,
        unitEnd: 10,
      }
    );

    const result = await executeTool(ctx, "apply_goal_adjustment", {
      goalTitle: "anatomy",
      deadline: "2026-07-10",
      spreadEvenly: true,
      confirmed: true,
    });

    expect(result.ok).toBe(true);
    expect(result.data.applied).toBe(true);
    expect(result.data.createdCount).toBeGreaterThan(0);
    expect(db.tasks.some((t) => t.id === "done_1")).toBe(true);
    expect(db.tasks.some((t) => t.id === "todo_1")).toBe(false);
    const goal = db.goals.get("goal_anatomy");
    expect(new Date(goal.deadline).toISOString().slice(0, 10)).toBe("2026-07-10");
  });

  test("runLlmTurn confirms rebalance using pendingConfirmation", async () => {
    seedRebalanceGoal(mockGetTestDb());
    const preview = await executeTool(ctx, "get_goal_agent_preview", { goalId: "goal_1" });

    const res = await runChatTurn({
      userId: "user_1",
      message: "Yes, apply it",
      tzOffsetMinutes: 0,
      pendingConfirmation: preview.data.pendingConfirmation,
    });

    expect(res.toolResults).toHaveLength(1);
    expect(res.toolResults[0].tool).toBe("apply_goal_rebalance");
    expect(res.toolResults[0].args.confirmed).toBe(true);
    expect(res.toolResults[0].ok).toBe(true);
    expect(res.pendingConfirmation).toBeNull();
  });
});
