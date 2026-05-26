const request = require("supertest");
const bcrypt = require("bcrypt");
const { loginAs } = require("../helpers/authTestHelpers");

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
    findMany: jest.fn(async ({ where }) => {
      return db.tasks.filter((t) => {
        if (t.userId !== where.userId) return false;
        if (where.status) {
          if (typeof where.status === "object" && where.status.not) {
            if (t.status === where.status.not) return false;
          } else if (t.status !== where.status) {
            return false;
          }
        }
        if (where.goalId && t.goalId !== where.goalId) return false;
        if (where.dueDate?.gte && (!t.dueDate || t.dueDate < where.dueDate.gte)) {
          return false;
        }
        if (where.dueDate?.lte) {
          const end = where.dueDate.lte;
          if (!t.dueDate || t.dueDate > end) return false;
        }
        return true;
      });
    }),
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
    findMany: jest.fn(async ({ where }) => {
      return db.focusSessions.filter((s) => {
        if (s.userId !== where.userId) return false;
        if (where.startedAt?.gte && s.startedAt < where.startedAt.gte) return false;
        if (where.startedAt?.lt && s.startedAt >= where.startedAt.lt) return false;
        return true;
      });
    }),
  },
  journalNote: {},
  agentRun: {},
  $transaction: jest.fn(),
};

jest.mock("../../src/lib/prisma", () => mockPrisma);

const { createApp } = require("../../src/app");

function utcTomorrowAt(hour, minute = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(hour, minute, 0, 0);
  return d;
}

function utcTodayAt(hour, minute = 0) {
  const d = new Date();
  d.setUTCHours(hour, minute, 0, 0);
  return d;
}

describe("POST /agent/chat (rule-based fallback)", () => {
  const savedKey = process.env.OPENAI_API_KEY;

  beforeEach(async () => {
    delete process.env.OPENAI_API_KEY;
    jest.clearAllMocks();
    db.users.clear();
    db.goals.clear();
    db.tasks = [];
    db.focusSessions = [];

    process.env.JWT_SECRET = "test-jwt-secret";

    const hashed = await bcrypt.hash("ValidPass123!", 10);
    db.users.set("user_1", {
      id: "user_1",
      email: "alice@example.com",
      name: "Alice",
      password: hashed,
      streakCount: 0,
      streakDateKey: "2026-05-23",
    });
    db.users.set("user_2", {
      id: "user_2",
      email: "bob@example.com",
      name: "Bob",
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

    db.tasks.push(
      {
        id: "task_today",
        userId: "user_1",
        goalId: null,
        title: "Due today",
        status: "todo",
        priority: "medium",
        dueDate: utcTodayAt(18),
        createdAt: new Date(),
      },
      {
        id: "task_done_today",
        userId: "user_1",
        goalId: null,
        title: "Already done today",
        status: "done",
        priority: "medium",
        dueDate: utcTodayAt(10),
        createdAt: new Date(),
      },
      {
        id: "task_tomorrow",
        userId: "user_1",
        goalId: null,
        title: "Due tomorrow",
        status: "todo",
        priority: "medium",
        dueDate: utcTomorrowAt(9),
        createdAt: new Date(),
      }
    );
  });

  afterEach(() => {
    if (savedKey) process.env.OPENAI_API_KEY = savedKey;
  });

  test("requires auth", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/agent/chat")
      .send({ message: "show today's tasks" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Authentication required");
  });

  test("lists today's incomplete tasks for the authenticated user", async () => {
    const app = createApp();
    const agent = request.agent(app);
    const loginRes = await loginAs(agent, {
      email: "alice@example.com",
      password: "ValidPass123!",
    });
    expect(loginRes.status).toBe(200);

    const res = await agent.post("/agent/chat").send({
      message: "What are my tasks today?",
      tzOffsetMinutes: 0,
    });

    expect(res.status).toBe(200);
    expect(res.body.pendingConfirmation).toBeNull();
    expect(res.body.toolResults).toHaveLength(1);
    expect(res.body.toolResults[0].tool).toBe("list_tasks");
    expect(res.body.toolResults[0].ok).toBe(true);
    expect(res.body.toolResults[0].args).toMatchObject({
      includeOverdue: true,
      excludeDone: true,
    });
    expect(res.body.assistantMessage).toMatch(/Due today/);
    expect(res.body.assistantMessage).not.toMatch(/Already done today/);
    expect(res.body.assistantMessage).not.toMatch(/Due tomorrow/);
    expect(res.body.clientActions).toEqual([]);
  });

  test("show my tasks excludes completed tasks", async () => {
    const app = createApp();
    const agent = request.agent(app);
    await loginAs(agent, {
      email: "alice@example.com",
      password: "ValidPass123!",
    });

    const res = await agent.post("/agent/chat").send({
      message: "show my tasks",
      tzOffsetMinutes: 0,
    });

    expect(res.status).toBe(200);
    expect(res.body.toolResults[0].args.excludeDone).toBe(true);
    expect(res.body.assistantMessage).toMatch(/Due today/);
    expect(res.body.assistantMessage).not.toMatch(/Already done today/);
  });

  test("creates a task when title and due date/time are provided", async () => {
    const app = createApp();
    const agent = request.agent(app);
    await loginAs(agent, {
      email: "alice@example.com",
      password: "ValidPass123!",
    });

    const beforeCount = db.tasks.length;
    const res = await agent.post("/agent/chat").send({
      message: "Create a task to work out tomorrow at 11am",
      tzOffsetMinutes: 0,
    });

    expect(res.status).toBe(200);
    expect(res.body.toolResults).toHaveLength(1);
    expect(res.body.toolResults[0].tool).toBe("create_task");
    expect(res.body.toolResults[0].ok).toBe(true);
    expect(db.tasks.length).toBe(beforeCount + 1);

    const created = res.body.toolResults[0].result.data.task;
    expect(created.title).toBe("work out");
    expect(new Date(created.dueDate).toISOString()).toBe(
      utcTomorrowAt(11).toISOString()
    );
    expect(res.body.assistantMessage).toMatch(/Created task/i);
  });

  test("asks for clarification when create task has no due date/time", async () => {
    const app = createApp();
    const agent = request.agent(app);
    await loginAs(agent, {
      email: "alice@example.com",
      password: "ValidPass123!",
    });

    const beforeCount = db.tasks.length;
    const res = await agent.post("/agent/chat").send({
      message: "Create a task buy milk",
    });

    expect(res.status).toBe(200);
    expect(res.body.toolResults).toEqual([]);
    expect(res.body.pendingConfirmation).toBeNull();
    expect(res.body.assistantMessage).toMatch(/due date/i);
    expect(db.tasks.length).toBe(beforeCount);
    expect(mockPrisma.task.create).not.toHaveBeenCalled();
  });

  test("returns clientActions for start focus", async () => {
    const app = createApp();
    const agent = request.agent(app);
    await loginAs(agent, {
      email: "alice@example.com",
      password: "ValidPass123!",
    });

    const res = await agent.post("/agent/chat").send({
      message: "start focus",
    });

    expect(res.status).toBe(200);
    expect(res.body.toolResults[0].tool).toBe("suggest_focus_session");
    expect(res.body.toolResults[0].ok).toBe(true);
    expect(res.body.clientActions).toEqual([
      {
        type: "start_focus_session",
        mode: "focus",
        durationMinutes: 25,
        label: null,
      },
    ]);
    expect(db.focusSessions).toHaveLength(0);
  });

  test("previews plan for an owned goal", async () => {
    const app = createApp();
    const agent = request.agent(app);
    await loginAs(agent, {
      email: "alice@example.com",
      password: "ValidPass123!",
    });

    const res = await agent.post("/agent/chat").send({
      message: "preview plan for goal goal_1",
    });

    expect(res.status).toBe(200);
    expect(res.body.toolResults[0].ok).toBe(true);
    expect(res.body.toolResults[0].result.data.goal.id).toBe("goal_1");
    expect(Array.isArray(res.body.toolResults[0].result.data.items)).toBe(true);
    expect(res.body.assistantMessage).toMatch(/Preview only/i);
  });

  test("blocks cross-user goal plan preview", async () => {
    const app = createApp();
    const agent = request.agent(app);
    await loginAs(agent, {
      email: "bob@example.com",
      password: "ValidPass123!",
    });

    const res = await agent.post("/agent/chat").send({
      message: "preview plan for goal goal_1",
    });

    expect(res.status).toBe(200);
    expect(res.body.toolResults[0].ok).toBe(false);
    expect(res.body.toolResults[0].result.error).toMatch(/Forbidden|Goal not found/);
    expect(res.body.assistantMessage).toMatch(/Forbidden|Goal not found/);
  });
});
