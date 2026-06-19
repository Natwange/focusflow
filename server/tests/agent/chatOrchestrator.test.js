const {
  run,
  runLlmTurn,
  runRuleBasedFallback,
  executeToolChain,
  extractPendingConfirmation,
} = require("../../src/agent/chatOrchestrator");
const {
  isLlmConfigured,
  setCompleteAgentTurnForTests,
  setCompleteObserveRespondForTests,
  resetLlmClientForTests,
} = require("../../src/agent/llmClient");

function mockGetTestDb() {
  if (!global.__ffChatOrchDb) {
    global.__ffChatOrchDb = {
      users: new Map(),
      goals: new Map(),
      tasks: [],
      focusSessions: [],
      agentRuns: [],
    };
  }
  return global.__ffChatOrchDb;
}

jest.mock("../../src/lib/prisma", () => {
  if (!global.__ffChatOrchDb) {
    global.__ffChatOrchDb = {
      users: new Map(),
      goals: new Map(),
      tasks: [],
      focusSessions: [],
      agentRuns: [],
    };
  }
  const db = global.__ffChatOrchDb;
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
            } else if (t.status !== where.status) return false;
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
      findMany: jest.fn(async ({ where }) =>
        db.focusSessions.filter((s) => {
          if (where?.userId && s.userId !== where.userId) return false;
          return true;
        })
      ),
    },
    agentRun: {
      findMany: jest.fn(async ({ where }) =>
        db.agentRuns.filter((r) => {
          if (where?.userId && r.userId !== where.userId) return false;
          return true;
        })
      ),
    },
  };
});

describe("chatOrchestrator", () => {
  const savedKey = process.env.OPENAI_API_KEY;
  /** @type {Array<object>} */
  let observeInputs;

  beforeEach(() => {
    observeInputs = [];
    jest.clearAllMocks();
    resetLlmClientForTests();
    delete process.env.OPENAI_API_KEY;

    const db = mockGetTestDb();
    db.users.clear();
    db.goals.clear();
    db.tasks = [];
    db.focusSessions = [];

    db.users.set("user_1", {
      id: "user_1",
      streakCount: 1,
      streakDateKey: "2026-05-23",
    });

    const deadline = new Date();
    deadline.setUTCDate(deadline.getUTCDate() + 14);
    db.goals.set("goal_1", {
      id: "goal_1",
      userId: "user_1",
      title: "DSA",
      totalUnits: 10,
      unitName: "lessons",
      deadline,
      availableDays: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
      maxUnitsPerDay: 2,
    });
    db.goals.set("goal_other", {
      id: "goal_other",
      userId: "user_2",
      title: "Other",
      totalUnits: 5,
      unitName: "lessons",
      deadline,
      availableDays: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
      maxUnitsPerDay: 2,
    });
  });

  afterEach(() => {
    resetLlmClientForTests();
    if (savedKey) process.env.OPENAI_API_KEY = savedKey;
    else delete process.env.OPENAI_API_KEY;
  });

  test("falls back to rule parser when API key is missing", async () => {
    expect(isLlmConfigured()).toBe(false);
    const res = await run({
      userId: "user_1",
      message: "Create a task buy milk",
      tzOffsetMinutes: 0,
    });
    expect(res.toolResults).toEqual([]);
    expect(res.assistantMessage).toMatch(/due date/i);
  });

  test("executes a mocked LLM tool call through executeTool", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    setCompleteAgentTurnForTests(async () => ({
      type: "tool_call",
      toolName: "suggest_focus_session",
      rawArgs: { mode: "focus", durationMinutes: 25 },
    }));
    setCompleteObserveRespondForTests(async (input) => {
      observeInputs.push(input);
      return {
        type: "message",
        content: "You're set for a 25-minute focus block — open Focus when you're ready.",
      };
    });

    const res = await run({
      userId: "user_1",
      message: "start focus",
      tzOffsetMinutes: 0,
    });

    expect(res.toolResults).toHaveLength(1);
    expect(res.toolResults[0].tool).toBe("suggest_focus_session");
    expect(res.toolResults[0].ok).toBe(true);
    expect(observeInputs).toHaveLength(1);
    expect(observeInputs[0].toolName).toBe("suggest_focus_session");
    expect(observeInputs[0].args).toEqual({ mode: "focus", durationMinutes: 25 });
    expect(observeInputs[0].toolResult.ok).toBe(true);
    expect(res.assistantMessage).toBe(
      "You're set for a 25-minute focus block — open Focus when you're ready."
    );
    expect(res.assistantMessage).not.toMatch(/Open the Focus page to start/);
    expect(res.clientActions[0]).toMatchObject({
      type: "start_focus_session",
    });
  });

  test("passes tool result into observe/respond and uses final model text", async () => {
    setCompleteAgentTurnForTests(async () => ({
      type: "tool_call",
      toolName: "get_focus_summary",
      rawArgs: { tzOffsetMinutes: 0 },
    }));
    setCompleteObserveRespondForTests(async (input) => {
      observeInputs.push(input);
      return {
        type: "message",
        content: `Today you logged ${input.toolResult.data.todayMinutes} minutes.`,
      };
    });

    const res = await runLlmTurn({
      userId: "user_1",
      message: "how much focus time today?",
      tzOffsetMinutes: 0,
    });

    expect(observeInputs[0].message).toBe("how much focus time today?");
    expect(observeInputs[0].toolResult.summary).toMatch(/focus minute/i);
    expect(res.assistantMessage).toBe("Today you logged 0 minutes.");
  });

  test("falls back to tool summary when observe/respond fails", async () => {
    setCompleteAgentTurnForTests(async () => ({
      type: "tool_call",
      toolName: "suggest_focus_session",
      rawArgs: { mode: "focus", durationMinutes: 25 },
    }));
    setCompleteObserveRespondForTests(async () => {
      throw new Error("observe API down");
    });

    const res = await runLlmTurn({
      userId: "user_1",
      message: "start focus",
      tzOffsetMinutes: 0,
    });

    expect(res.assistantMessage).toMatch(/Starting a 25-minute focus session/);
    expect(res.clientActions).toHaveLength(1);
  });

  test("applies today incomplete filters when LLM calls list_tasks loosely", async () => {
    setCompleteAgentTurnForTests(async () => ({
      type: "tool_call",
      toolName: "list_tasks",
      rawArgs: {},
    }));
    setCompleteObserveRespondForTests(async () => ({
      type: "message",
      content: "Here are your tasks.",
    }));

    const res = await runLlmTurn({
      userId: "user_1",
      message: "what are my incomplete tasks for today",
      tzOffsetMinutes: 0,
    });

    expect(res.toolResults[0].args).toMatchObject({
      excludeDone: true,
      includeOverdue: true,
    });
    expect(res.toolResults[0].args.startDate).toBeDefined();
    expect(res.toolResults[0].args.endDate).toBeDefined();
  });

  test("does not call observe/respond when tool args are invalid", async () => {
    setCompleteAgentTurnForTests(async () => ({
      type: "tool_call",
      toolName: "create_task",
      rawArgs: { title: "" },
    }));
    setCompleteObserveRespondForTests(async (input) => {
      observeInputs.push(input);
      return { type: "message", content: "should not run" };
    });

    const res = await runLlmTurn({
      userId: "user_1",
      message: "create task",
      tzOffsetMinutes: 0,
    });

    expect(observeInputs).toHaveLength(0);
    expect(res.toolResults).toEqual([]);
  });

  test("rejects invalid tool args without DB writes", async () => {
    setCompleteAgentTurnForTests(async () => ({
      type: "tool_call",
      toolName: "create_task",
      rawArgs: { title: "" },
    }));

    const db = mockGetTestDb();
    const before = db.tasks.length;
    const res = await runLlmTurn({
      userId: "user_1",
      message: "create task",
      tzOffsetMinutes: 0,
    });

    expect(res.toolResults).toEqual([]);
    expect(res.assistantMessage).toMatch(/task be called|detail/i);
    expect(db.tasks).toHaveLength(before);
  });

  test("rejects unknown tool names without DB access", async () => {
    setCompleteAgentTurnForTests(async () => ({
      type: "tool_call",
      toolName: "delete_everything",
      rawArgs: {},
    }));

    const res = await runLlmTurn({
      userId: "user_1",
      message: "delete all",
      tzOffsetMinutes: 0,
    });

    expect(res.toolResults).toEqual([]);
    expect(res.assistantMessage).toMatch(/can help/i);
    expect(mockGetTestDb().tasks).toHaveLength(0);
  });

  test("enforces cross-user protection on preview_goal_plan", async () => {
    setCompleteAgentTurnForTests(async () => ({
      type: "tool_call",
      toolName: "preview_goal_plan",
      rawArgs: { goalId: "goal_other" },
    }));

    const res = await runLlmTurn({
      userId: "user_1",
      message: "preview plan",
      tzOffsetMinutes: 0,
    });

    expect(res.toolResults[0].ok).toBe(false);
    expect(res.toolResults[0].result.error).toMatch(/Forbidden|Goal not found/);
  });

  test("returns clarification when LLM replies without a tool", async () => {
    setCompleteAgentTurnForTests(async () => ({
      type: "message",
      content: "When is the task due?",
    }));

    const res = await runLlmTurn({
      userId: "user_1",
      message: "add a task called groceries",
      tzOffsetMinutes: 0,
    });

    expect(res.toolResults).toEqual([]);
    expect(res.assistantMessage).toBe("When is the task due?");
    expect(res.pendingConfirmation).toBeNull();
    expect(res.mutations).toEqual([]);
  });

  test("retries create_task when user says task was not added", async () => {
    setCompleteAgentTurnForTests(async () => {
      throw new Error("LLM should not be called for create retry");
    });
    setCompleteObserveRespondForTests(async () => {
      observeInputs.push("should-not-run");
      return { type: "message", content: "wrong" };
    });

    const db = mockGetTestDb();
    const before = db.tasks.length;
    const res = await runLlmTurn({
      userId: "user_1",
      message: "you havent added it, please add it",
      tzOffsetMinutes: 0,
      history: [
        {
          role: "user",
          text: "Add 'Meeting with Kabir' from 2:30pm to 3:00pm June 19th",
        },
        {
          role: "assistant",
          text: "Perfect! I've created your task.",
        },
      ],
    });

    expect(db.tasks).toHaveLength(before + 1);
    expect(res.toolResults).toHaveLength(1);
    expect(res.toolResults[0].tool).toBe("create_task");
    expect(res.toolResults[0].ok).toBe(true);
    expect(res.mutations).toContain("task_created");
    expect(observeInputs).toHaveLength(0);
    expect(res.assistantMessage).toMatch(/Meeting with Kabir/i);
  });

  test("uses tool summary for create_task without observe/respond", async () => {
    setCompleteAgentTurnForTests(async () => ({
      type: "tool_call",
      toolName: "create_task",
      rawArgs: {
        title: "Groceries",
        dueDate: "2026-06-20T15:00:00.000Z",
        priority: "medium",
      },
    }));
    setCompleteObserveRespondForTests(async (input) => {
      observeInputs.push(input);
      return { type: "message", content: "Created at the wrong time." };
    });

    const res = await runLlmTurn({
      userId: "user_1",
      message: "add groceries tomorrow at 3pm",
      tzOffsetMinutes: 0,
    });

    expect(res.toolResults[0].ok).toBe(true);
    expect(observeInputs).toHaveLength(0);
    expect(res.assistantMessage).toMatch(/Groceries/i);
    expect(res.assistantMessage).not.toBe("Created at the wrong time.");
    expect(res.mutations).toContain("task_created");
  });

  test("rule fallback create task still works", async () => {
    const res = await runRuleBasedFallback({
      userId: "user_1",
      message: "Create a task to work out tomorrow at 11am",
      tzOffsetMinutes: 0,
    });
    expect(res.toolResults[0].tool).toBe("create_task");
    expect(res.toolResults[0].ok).toBe(true);
  });

  test("executeToolChain auto-previews after create_goal", async () => {
    const ctx = { userId: "user_1", tzOffsetMinutes: 0 };
    const chain = await executeToolChain(ctx, "create_goal", {
      title: "Study JavaScript",
      totalUnits: 30,
      deadline: "in 7 days",
      unitName: "lessons",
    });

    expect(chain).toHaveLength(2);
    expect(chain[0].tool).toBe("create_goal");
    expect(chain[0].ok).toBe(true);
    expect(chain[1].tool).toBe("preview_goal_plan");
    expect(chain[1].ok).toBe(true);
    expect(chain[1].result.data.pendingConfirmation.type).toBe(
      "confirm_goal_plan"
    );
  });

  test("extractPendingConfirmation reads chained preview", async () => {
    const ctx = { userId: "user_1", tzOffsetMinutes: 0 };
    const chain = await executeToolChain(ctx, "create_goal", {
      title: "Learn DSA",
      totalUnits: 10,
      deadline: "in 14 days",
    });
    const pending = extractPendingConfirmation(chain);
    expect(pending).toMatchObject({ type: "confirm_goal_plan" });
    expect(pending.goalId).toBeTruthy();
  });

  test("runLlmTurn confirms goal plan using client pendingConfirmation", async () => {
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

    const res = await runLlmTurn({
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
    expect(res.toolResults[0].args.goalId).toBe(goalId);
    expect(res.toolResults[0].args.confirmed).toBe(true);
    expect(res.toolResults[0].ok).toBe(true);
    expect(res.pendingConfirmation).toBeNull();
  });

  test("runLlmTurn can return behavior context for planning", async () => {
    setCompleteAgentTurnForTests(async () => ({
      type: "tool_call",
      toolName: "get_user_behavior_context",
      rawArgs: { lookbackDays: 30 },
    }));
    setCompleteObserveRespondForTests(async () => ({
      type: "message",
      content: "I reviewed your recent activity patterns.",
    }));

    const res = await runLlmTurn({
      userId: "user_1",
      message: "Help me study JavaScript in 7 days",
      tzOffsetMinutes: 0,
    });

    expect(res.toolResults[0].tool).toBe("get_user_behavior_context");
    expect(res.toolResults[0].ok).toBe(true);
    expect(res.toolResults[0].result.data.signals).toBeDefined();
    expect(res.toolResults[0].result.data.signals.dayOfWeekStats).toHaveLength(7);
  });

  test("runLlmTurn create_goal returns pendingConfirmation for plan approval", async () => {
    setCompleteAgentTurnForTests(async () => ({
      type: "tool_call",
      toolName: "create_goal",
      rawArgs: {
        title: "Study JS",
        totalUnits: 30,
        deadline: "in 7 days",
      },
    }));

    const res = await runLlmTurn({
      userId: "user_1",
      message: "Create a goal to study JS with 30 units in 7 days",
      tzOffsetMinutes: 0,
    });

    expect(res.toolResults).toHaveLength(2);
    expect(res.toolResults[0].tool).toBe("create_goal");
    expect(res.toolResults[1].tool).toBe("preview_goal_plan");
    expect(res.pendingConfirmation).toMatchObject({
      type: "confirm_goal_plan",
    });
    expect(res.assistantMessage).toMatch(/confirm|create it/i);
  });
});
