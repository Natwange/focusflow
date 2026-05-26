const {
  run,
  runLlmTurn,
  runRuleBasedFallback,
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
    },
    task: {
      findMany: jest.fn(async ({ where }) =>
        db.tasks.filter((t) => {
          if (t.userId !== where.userId) return false;
          if (where.status) {
            if (typeof where.status === "object" && where.status.not) {
              if (t.status === where.status.not) return false;
            } else if (t.status !== where.status) return false;
          }
          return true;
        })
      ),
      create: jest.fn(async ({ data }) => {
        const row = {
          id: `task_${db.tasks.length + 1}`,
          createdAt: new Date(),
          status: "todo",
          ...data,
        };
        db.tasks.push(row);
        return row;
      }),
    },
    focusSession: {
      findMany: jest.fn(async () => []),
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
    expect(res.assistantMessage).toMatch(/only help/i);
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
});
