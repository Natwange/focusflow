const request = require("supertest");
const bcrypt = require("bcrypt");
const { loginAs } = require("../helpers/authTestHelpers");

const db = {
  users: new Map(),
  goals: new Map(),
  tasks: [],
};

function pickSelected(record, select) {
  if (!select) return { ...record };
  const out = {};
  for (const key of Object.keys(select)) {
    if (select[key]) out[key] = record[key];
  }
  return out;
}

const mockPrisma = {
  user: {
    findUnique: jest.fn(async ({ where, select }) => {
      let record = null;
      if (where?.id) record = db.users.get(where.id) || null;
      if (where?.email) {
        record = [...db.users.values()].find((u) => u.email === where.email) || null;
      }
      if (!record) return null;
      return pickSelected(record, select);
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
      return pickSelected(record, select);
    }),
    findMany: jest.fn(async () => []),
  },
  task: {
    findMany: jest.fn(async ({ where, select }) => {
      const rows = db.tasks.filter((t) => t.goalId === where.goalId && t.userId === where.userId);
      return rows.map((row) => pickSelected(row, select));
    }),
    update: jest.fn(async ({ where, data, select }) => {
      const idx = db.tasks.findIndex((t) => t.id === where.id);
      if (idx < 0) throw new Error("Task not found");
      db.tasks[idx] = {
        ...db.tasks[idx],
        ...(data?.dueDate !== undefined ? { dueDate: data.dueDate } : {}),
      };
      return pickSelected(db.tasks[idx], select);
    }),
    create: jest.fn(async () => {
      throw new Error("task.create should not be called by apply-agent-rebalance");
    }),
    deleteMany: jest.fn(async () => {
      throw new Error("task.deleteMany should not be called by apply-agent-rebalance");
    }),
  },
  journalNote: {},
  focusSession: {},
  $transaction: jest.fn(async (ops) => Promise.all(ops)),
};

jest.mock("../../src/lib/prisma", () => mockPrisma);

const { createApp } = require("../../src/app");

describe("POST /goals/:id/apply-agent-rebalance", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    db.users.clear();
    db.goals.clear();
    db.tasks = [];

    process.env.JWT_SECRET = "test-jwt-secret";
    const hashed = await bcrypt.hash("ValidPass123!", 10);

    db.users.set("user_1", {
      id: "user_1",
      email: "alice@example.com",
      name: "Alice",
      password: hashed,
    });
    db.users.set("user_2", {
      id: "user_2",
      email: "bob@example.com",
      name: "Bob",
      password: hashed,
    });

    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    db.goals.set("goal_1", {
      id: "goal_1",
      userId: "user_1",
      createdAt: new Date(now - 10 * day),
      deadline: new Date(now + 10 * day),
      availableDays: [0, 1, 2, 3, 4, 5, 6],
      maxUnitsPerDay: 3,
    });

    db.tasks.push(
      {
        id: "task_missed",
        title: "Missed unit",
        userId: "user_1",
        goalId: "goal_1",
        status: "todo",
        dueDate: new Date(now - 2 * day),
        unitStart: 1,
        unitEnd: 1,
      },
      {
        id: "task_future",
        title: "Future unit",
        userId: "user_1",
        goalId: "goal_1",
        status: "todo",
        dueDate: new Date(now + 3 * day),
        unitStart: 2,
        unitEnd: 2,
      },
      {
        id: "task_done",
        title: "Completed unit",
        userId: "user_1",
        goalId: "goal_1",
        status: "done",
        dueDate: new Date(now - 1 * day),
        unitStart: 3,
        unitEnd: 3,
      }
    );
  });

  test("auth required", async () => {
    const app = createApp();
    const res = await request(app).post("/goals/goal_1/apply-agent-rebalance");
    expect(res.status).toBe(401);
  });

  test("non-owner forbidden", async () => {
    const app = createApp();
    const agent = request.agent(app);
    const loginRes = await loginAs(agent, {
      email: "bob@example.com",
      password: "ValidPass123!",
    });
    expect(loginRes.status).toBe(200);

    const res = await agent.post("/goals/goal_1/apply-agent-rebalance");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Forbidden: goal does not belong to this user");
  });

  test("applies valid rebalance", async () => {
    const app = createApp();
    const agent = request.agent(app);
    const loginRes = await loginAs(agent, {
      email: "alice@example.com",
      password: "ValidPass123!",
    });
    expect(loginRes.status).toBe(200);

    const beforeMissed = db.tasks.find((t) => t.id === "task_missed").dueDate.toISOString();
    const res = await agent.post("/goals/goal_1/apply-agent-rebalance");

    expect(res.status).toBe(200);
    expect(res.body.goalId).toBe("goal_1");
    expect(res.body.applied).toBe(true);
    expect(Array.isArray(res.body.updatedTasks)).toBe(true);
    expect(res.body.updatedTasks.length).toBeGreaterThan(0);
    expect(res.body.agentResult).toBeDefined();

    const afterMissed = db.tasks.find((t) => t.id === "task_missed").dueDate.toISOString();
    expect(afterMissed).not.toBe(beforeMissed);
  });

  test("does not modify completed tasks", async () => {
    const app = createApp();
    const agent = request.agent(app);
    const loginRes = await loginAs(agent, {
      email: "alice@example.com",
      password: "ValidPass123!",
    });
    expect(loginRes.status).toBe(200);

    const doneBefore = db.tasks.find((t) => t.id === "task_done").dueDate.toISOString();
    const res = await agent.post("/goals/goal_1/apply-agent-rebalance");
    expect(res.status).toBe(200);
    const doneAfter = db.tasks.find((t) => t.id === "task_done").dueDate.toISOString();
    expect(doneAfter).toBe(doneBefore);
    expect(res.body.updatedTasks.some((t) => t.id === "task_done")).toBe(false);
  });

  test("returns 400 if canRebalance is false", async () => {
    db.tasks = [
      {
        id: "only_done",
        title: "Done",
        userId: "user_1",
        goalId: "goal_1",
        status: "done",
        dueDate: new Date(),
        unitStart: 1,
        unitEnd: 1,
      },
    ];

    const app = createApp();
    const agent = request.agent(app);
    const loginRes = await loginAs(agent, {
      email: "alice@example.com",
      password: "ValidPass123!",
    });
    expect(loginRes.status).toBe(200);

    const res = await agent.post("/goals/goal_1/apply-agent-rebalance");
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(typeof res.body.nextAction).toBe("string");
  });

  test("does not create/delete tasks", async () => {
    const app = createApp();
    const agent = request.agent(app);
    const loginRes = await loginAs(agent, {
      email: "alice@example.com",
      password: "ValidPass123!",
    });
    expect(loginRes.status).toBe(200);

    const beforeCount = db.tasks.length;
    const res = await agent.post("/goals/goal_1/apply-agent-rebalance");
    expect(res.status).toBe(200);
    expect(db.tasks.length).toBe(beforeCount);
    expect(mockPrisma.task.create).not.toHaveBeenCalled();
    expect(mockPrisma.task.deleteMany).not.toHaveBeenCalled();
  });
});
