const fs = require("fs");
const path = require("path");
const {
  run,
  getOrchestratorMode,
  runLlmTurn,
  executeToolChain,
} = require("../../src/agent/chatOrchestrator");
const {
  runLangGraphAgent,
  resetCompiledAgentGraphForTests,
} = require("../../src/agent/langGraphAgent");
const {
  setCompleteAgentTurnForTests,
  setCompleteObserveRespondForTests,
  resetLlmClientForTests,
} = require("../../src/agent/llmClient");

function mockGetTestDb() {
  if (!global.__ffLangGraphDb) {
    global.__ffLangGraphDb = {
      users: new Map(),
      goals: new Map(),
      tasks: [],
      focusSessions: [],
      agentRuns: [],
    };
  }
  return global.__ffLangGraphDb;
}

jest.mock("../../src/lib/prisma", () => {
  if (!global.__ffLangGraphDb) {
    global.__ffLangGraphDb = {
      users: new Map(),
      goals: new Map(),
      tasks: [],
      focusSessions: [],
      agentRuns: [],
    };
  }
  const db = global.__ffLangGraphDb;
  return {
    user: {
      findUnique: jest.fn(async ({ where, select }) => {
        const record = db.users.get(where.id) || null;
        if (!record) return null;
        if (!select) return { ...record };
        const out = {};
        for (const key of Object.keys(select)) {
          if (select[key]) out[key] = record[key];
        }
        return out;
      }),
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
      create: jest.fn(async ({ data }) => {
        const row = {
          id: `goal_${db.goals.size + 1}`,
          createdAt: new Date(),
          availableDays: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
          maxUnitsPerDay: null,
          ...data,
        };
        db.goals.set(row.id, row);
        return row;
      }),
      findMany: jest.fn(async ({ where }) =>
        [...db.goals.values()].filter((g) => {
          if (where.userId && g.userId !== where.userId) return false;
          return true;
        })
      ),
    },
    task: {
      findMany: jest.fn(async ({ where }) =>
        db.tasks.filter((t) => {
          if (where.userId && t.userId !== where.userId) return false;
          if (where.OR) return true;
          if (where.status) {
            if (typeof where.status === "object" && where.status.not) {
              if (t.status === where.status.not) return false;
            } else if (t.status !== where.status) {
              return false;
            }
          }
          return true;
        })
      ),
      create: jest.fn(async ({ data, select }) => {
        const row = {
          id: `task_${db.tasks.length + 1}`,
          createdAt: new Date(),
          status: "todo",
          ...data,
        };
        db.tasks.push(row);
        if (select) {
          const out = {};
          for (const key of Object.keys(select)) {
            if (select[key]) out[key] = row[key];
          }
          return out;
        }
        return row;
      }),
      count: jest.fn(async ({ where }) =>
        db.tasks.filter((t) => {
          if (where.userId && t.userId !== where.userId) return false;
          if (where.goalId && t.goalId !== where.goalId) return false;
          return true;
        }).length
      ),
    },
    $transaction: jest.fn(async (ops) => {
      const results = [];
      for (const op of ops) {
        results.push(await op);
      }
      return results;
    }),
    focusSession: {
      findMany: jest.fn(async () => []),
    },
    agentRun: {
      findMany: jest.fn(async () => []),
    },
  };
});

describe("langGraphAgent", () => {
  const savedOrchestrator = process.env.AGENT_ORCHESTRATOR;
  const savedKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    resetLlmClientForTests();
    resetCompiledAgentGraphForTests();
    delete process.env.AGENT_ORCHESTRATOR;
    process.env.OPENAI_API_KEY = "test-key";

    const db = mockGetTestDb();
    db.users.clear();
    db.goals.clear();
    db.tasks = [];
    db.users.set("user_1", {
      id: "user_1",
      streakCount: 1,
      streakDateKey: "2026-05-23",
    });
  });

  afterEach(() => {
    resetLlmClientForTests();
    resetCompiledAgentGraphForTests();
    if (savedOrchestrator) process.env.AGENT_ORCHESTRATOR = savedOrchestrator;
    else delete process.env.AGENT_ORCHESTRATOR;
    if (savedKey) process.env.OPENAI_API_KEY = savedKey;
    else delete process.env.OPENAI_API_KEY;
  });

  test("returns same response shape as custom orchestrator", async () => {
    setCompleteAgentTurnForTests(async () => ({
      type: "message",
      content: "When is it due?",
    }));

    const custom = await runLlmTurn({
      userId: "user_1",
      message: "add groceries",
      tzOffsetMinutes: 0,
    });
    const graph = await runLangGraphAgent({
      userId: "user_1",
      message: "add groceries",
      tzOffsetMinutes: 0,
    });

    expect(graph).toEqual(
      expect.objectContaining({
        assistantMessage: expect.any(String),
        toolResults: expect.any(Array),
        pendingConfirmation: null,
        clientActions: expect.any(Array),
      })
    );
    expect(graph.assistantMessage).toBe(custom.assistantMessage);
    expect(graph.toolResults).toEqual(custom.toolResults);
  });

  test("executes tool calls through toolExecutor", async () => {
    setCompleteAgentTurnForTests(async () => ({
      type: "tool_call",
      toolName: "suggest_focus_session",
      rawArgs: { mode: "focus", durationMinutes: 25 },
    }));
    setCompleteObserveRespondForTests(async () => ({
      type: "message",
      content: "Ready for 25 minutes of focus.",
    }));

    const res = await runLangGraphAgent({
      userId: "user_1",
      message: "start focus",
      tzOffsetMinutes: 0,
    });

    expect(res.toolResults).toHaveLength(1);
    expect(res.toolResults[0].tool).toBe("suggest_focus_session");
    expect(res.toolResults[0].ok).toBe(true);
    expect(res.assistantMessage).toBe("Ready for 25 minutes of focus.");
  });

  test("pending confirmation still works via graph", async () => {
    const chain = await executeToolChain(
      { userId: "user_1", tzOffsetMinutes: 0 },
      "create_goal",
      {
        title: "Study JS",
        totalUnits: 30,
        deadline: "in 7 days",
      }
    );
    const goalId = chain[0].result.data.goal.id;

    setCompleteObserveRespondForTests(async () => ({
      type: "message",
      content: "Goal plan confirmed and scheduled.",
    }));

    const res = await runLangGraphAgent({
      userId: "user_1",
      message: "yes, create it",
      tzOffsetMinutes: 0,
      pendingConfirmation: {
        type: "confirm_goal_plan",
        goalId,
        goalTitle: "Study JS",
        itemCount: 8,
      },
    });

    expect(res.toolResults).toHaveLength(1);
    expect(res.toolResults[0].tool).toBe("confirm_goal_plan");
    expect(res.toolResults[0].args.confirmed).toBe(true);
    expect(res.pendingConfirmation).toBeNull();
  });

  test("blocks invalid tool args without execution", async () => {
    setCompleteAgentTurnForTests(async () => ({
      type: "tool_call",
      toolName: "create_task",
      rawArgs: { title: "" },
    }));

    const db = mockGetTestDb();
    const before = db.tasks.length;
    const res = await runLangGraphAgent({
      userId: "user_1",
      message: "create task",
      tzOffsetMinutes: 0,
    });

    expect(res.toolResults).toEqual([]);
    expect(res.assistantMessage).toMatch(/task be called|detail/i);
    expect(db.tasks).toHaveLength(before);
  });

  test("preserves clientActions from tool results", async () => {
    setCompleteAgentTurnForTests(async () => ({
      type: "tool_call",
      toolName: "suggest_focus_session",
      rawArgs: { mode: "focus", durationMinutes: 25 },
    }));
    setCompleteObserveRespondForTests(async () => ({
      type: "message",
      content: "Focus time.",
    }));

    const res = await runLangGraphAgent({
      userId: "user_1",
      message: "25 min focus",
      tzOffsetMinutes: 0,
    });

    expect(res.clientActions[0]).toMatchObject({
      type: "start_focus_session",
    });
  });

  test("chatOrchestrator defaults to custom orchestrator", () => {
    delete process.env.AGENT_ORCHESTRATOR;
    expect(getOrchestratorMode()).toBe("custom");
  });

  test("chatOrchestrator run() uses custom path by default", async () => {
    setCompleteAgentTurnForTests(async () => ({
      type: "message",
      content: "Hello from custom.",
    }));

    const res = await run({
      userId: "user_1",
      message: "hi",
      tzOffsetMinutes: 0,
    });

    expect(getOrchestratorMode()).toBe("custom");
    expect(res.assistantMessage).toBe("Hello from custom.");
  });

  test("chatOrchestrator run() uses LangGraph when env set", async () => {
    process.env.AGENT_ORCHESTRATOR = "langgraph";
    setCompleteAgentTurnForTests(async () => ({
      type: "message",
      content: "Hello from graph.",
    }));

    const res = await run({
      userId: "user_1",
      message: "hi",
      tzOffsetMinutes: 0,
    });

    expect(res.assistantMessage).toBe("Hello from graph.");
  });

  test("graph nodes do not import prisma directly", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "../../src/agent/langGraphAgent.js"),
      "utf8"
    );
    expect(source).not.toMatch(/require\(["']\.\.\/lib\/prisma["']\)/);
    expect(source).not.toMatch(/prisma\./);
  });
});
