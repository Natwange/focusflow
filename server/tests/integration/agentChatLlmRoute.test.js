const request = require("supertest");
const bcrypt = require("bcrypt");
const { loginAs } = require("../helpers/authTestHelpers");
const {
  setCompleteAgentTurnForTests,
  setCompleteObserveRespondForTests,
  resetLlmClientForTests,
} = require("../../src/agent/llmClient");

const db = {
  users: new Map(),
  goals: new Map(),
  tasks: [],
  focusSessions: [],
};

const mockPrisma = {
  user: {
    findUnique: jest.fn(async ({ where, select }) => {
      let record = null;
      if (where?.id) record = db.users.get(where.id) || null;
      if (where?.email) {
        record = [...db.users.values()].find((u) => u.email === where.email) || null;
      }
      if (!record) return null;
      if (!select) return { ...record };
      const out = {};
      for (const key of Object.keys(select)) {
        if (select[key]) out[key] = record[key];
      }
      return out;
    }),
  },
  refreshToken: {
    create: jest.fn(async () => ({ id: "rt_1" })),
    findUnique: jest.fn(async () => null),
    delete: jest.fn(async () => ({})),
    deleteMany: jest.fn(async () => ({ count: 0 })),
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
    findMany: jest.fn(async () => []),
  },
  task: {
    findMany: jest.fn(async ({ where }) =>
      db.tasks.filter((t) => {
        if (t.userId !== where.userId) return false;
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
    create: jest.fn(async ({ data }) => {
      const row = {
        id: `task_${db.tasks.length + 1}`,
        createdAt: new Date(),
        status: "todo",
        completedAt: null,
        ...data,
      };
      db.tasks.push(row);
      return row;
    }),
  },
  focusSession: {
    findMany: jest.fn(async () => []),
  },
  journalNote: {},
  agentRun: {},
  $transaction: jest.fn(),
};

jest.mock("../../src/lib/prisma", () => mockPrisma);

const { createApp } = require("../../src/app");

describe("POST /agent/chat (LLM path)", () => {
  const savedKey = process.env.OPENAI_API_KEY;
  const savedModel = process.env.AGENT_MODEL;

  beforeEach(async () => {
    resetLlmClientForTests();
    process.env.OPENAI_API_KEY = "test-key";
    process.env.AGENT_MODEL = "gpt-4o-mini";
    process.env.JWT_SECRET = "test-jwt-secret";
    jest.clearAllMocks();
    db.users.clear();
    db.goals.clear();
    db.tasks = [];
    db.focusSessions = [];

    const hashed = await bcrypt.hash("ValidPass123!", 10);
    db.users.set("user_1", {
      id: "user_1",
      email: "alice@example.com",
      name: "Alice",
      password: hashed,
      streakCount: 0,
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
  });

  afterEach(() => {
    resetLlmClientForTests();
    if (savedKey) process.env.OPENAI_API_KEY = savedKey;
    else delete process.env.OPENAI_API_KEY;
    if (savedModel) process.env.AGENT_MODEL = savedModel;
    else delete process.env.AGENT_MODEL;
  });

  test("LLM tool call creates task via executeTool only", async () => {
    const due = new Date();
    due.setUTCDate(due.getUTCDate() + 2);
    due.setUTCHours(15, 0, 0, 0);

    setCompleteAgentTurnForTests(async () => ({
      type: "tool_call",
      toolName: "create_task",
      rawArgs: {
        title: "LLM task",
        dueDate: due.toISOString(),
        priority: "medium",
      },
    }));
    setCompleteObserveRespondForTests(async (input) => ({
      type: "message",
      content: `All set — I added "${input.toolResult.data.task.title}" to your list.`,
    }));

    const app = createApp();
    const agent = request.agent(app);
    await loginAs(agent, {
      email: "alice@example.com",
      password: "ValidPass123!",
    });

    const before = db.tasks.length;
    const res = await agent.post("/agent/chat").send({
      message: "please create my task",
      tzOffsetMinutes: 0,
    });

    expect(res.status).toBe(200);
    expect(res.body.toolResults).toHaveLength(1);
    expect(res.body.toolResults[0].tool).toBe("create_task");
    expect(res.body.toolResults[0].ok).toBe(true);
    expect(db.tasks.length).toBe(before + 1);
    expect(res.body.pendingConfirmation).toBeNull();
    expect(res.body.assistantMessage).toBe(
      'All set — I added "LLM task" to your list.'
    );
    expect(res.body.clientActions).toEqual([]);
  });

  test("invalid LLM tool args return clarification without create", async () => {
    setCompleteAgentTurnForTests(async () => ({
      type: "tool_call",
      toolName: "create_task",
      rawArgs: { title: "x", dueDate: "not-a-date" },
    }));

    const app = createApp();
    const agent = request.agent(app);
    await loginAs(agent, {
      email: "alice@example.com",
      password: "ValidPass123!",
    });

    const before = db.tasks.length;
    const res = await agent.post("/agent/chat").send({
      message: "create task",
    });

    expect(res.status).toBe(200);
    expect(res.body.toolResults).toEqual([]);
    expect(res.body.assistantMessage).toMatch(/detail|due/i);
    expect(db.tasks.length).toBe(before);
    expect(mockPrisma.task.create).not.toHaveBeenCalled();
  });
});
