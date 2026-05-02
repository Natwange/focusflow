const request = require("supertest");
const bcrypt = require("bcrypt");
const { loginAs } = require("../helpers/authTestHelpers");

const db = {
  users: new Map(),
  goals: new Map(),
  tasks: [],
  agentRuns: [],
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
  },
  agentRun: {
    create: jest.fn(async ({ data }) => {
      const row = {
        id: `ar_${db.agentRuns.length + 1}`,
        ...data,
        acceptedByUser: false,
        createdAt: new Date(),
      };
      db.agentRuns.push(row);
      return row;
    }),
    findMany: jest.fn(async ({ where, orderBy, select }) => {
      let rows = db.agentRuns.filter(
        (r) => r.goalId === where.goalId && r.userId === where.userId
      );
      if (orderBy?.createdAt === "desc") {
        rows = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }
      return rows.map((row) => pickSelected(row, select));
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
  },
  journalNote: {},
  focusSession: {},
  $transaction: jest.fn(async (ops) => Promise.all(ops)),
};

jest.mock("../../src/lib/prisma", () => mockPrisma);

const { createApp } = require("../../src/app");

describe("Agent run logging", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    db.users.clear();
    db.goals.clear();
    db.tasks = [];
    db.agentRuns = [];
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
        id: "task_1",
        title: "Lesson 1",
        userId: "user_1",
        goalId: "goal_1",
        status: "todo",
        dueDate: new Date(now - 2 * day),
        unitStart: 1,
        unitEnd: 1,
      },
      {
        id: "task_2",
        title: "Lesson 2",
        userId: "user_1",
        goalId: "goal_1",
        status: "todo",
        dueDate: new Date(now + 3 * day),
        unitStart: 2,
        unitEnd: 2,
      }
    );
  });

  test("agent-preview creates AgentRun record", async () => {
    const app = createApp();
    const agent = request.agent(app);
    await loginAs(agent, { email: "alice@example.com", password: "ValidPass123!" });

    const res = await agent.get("/goals/goal_1/agent-preview");
    expect(res.status).toBe(200);
    expect(mockPrisma.agentRun.create).toHaveBeenCalledTimes(1);
    const call = mockPrisma.agentRun.create.mock.calls[0][0];
    expect(call.data.goalId).toBe("goal_1");
    expect(call.data.userId).toBe("user_1");
    expect(call.data.evaluation).toBeDefined();
    expect(call.data.failureAnalysis).toBeDefined();
    expect(typeof call.data.recommendation).toBe("string");
    expect(typeof call.data.nextAction).toBe("string");
    expect(call.data.rebalancePreview).toBeDefined();
    expect(db.agentRuns.length).toBe(1);
    expect(db.agentRuns[0].acceptedByUser).toBe(false);
  });

  test("apply-agent-rebalance marks most recent AgentRun acceptedByUser", async () => {
    db.agentRuns.push({
      id: "ar_old",
      goalId: "goal_1",
      userId: "user_1",
      evaluation: {},
      failureAnalysis: {},
      recommendation: "old",
      nextAction: "rebalance",
      rebalancePreview: {},
      acceptedByUser: false,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    db.agentRuns.push({
      id: "ar_new",
      goalId: "goal_1",
      userId: "user_1",
      evaluation: {},
      failureAnalysis: {},
      recommendation: "new",
      nextAction: "rebalance",
      rebalancePreview: {},
      acceptedByUser: false,
      createdAt: new Date("2026-05-02T00:00:00.000Z"),
    });

    const app = createApp();
    const agent = request.agent(app);
    await loginAs(agent, { email: "alice@example.com", password: "ValidPass123!" });

    const res = await agent.post("/goals/goal_1/apply-agent-rebalance");
    expect(res.status).toBe(200);
    const newest = db.agentRuns.find((r) => r.id === "ar_new");
    const older = db.agentRuns.find((r) => r.id === "ar_old");
    expect(newest.acceptedByUser).toBe(true);
    expect(older.acceptedByUser).toBe(false);
  });

  test("agent-history returns correct data ordered newest first", async () => {
    db.agentRuns.push({
      id: "ar_a",
      goalId: "goal_1",
      userId: "user_1",
      evaluation: {},
      failureAnalysis: {},
      recommendation: "first",
      nextAction: "keep_plan",
      rebalancePreview: {},
      acceptedByUser: true,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    db.agentRuns.push({
      id: "ar_b",
      goalId: "goal_1",
      userId: "user_1",
      evaluation: {},
      failureAnalysis: {},
      recommendation: "second",
      nextAction: "rebalance",
      rebalancePreview: {},
      acceptedByUser: false,
      createdAt: new Date("2026-05-03T00:00:00.000Z"),
    });

    const app = createApp();
    const agent = request.agent(app);
    await loginAs(agent, { email: "alice@example.com", password: "ValidPass123!" });

    const res = await agent.get("/goals/goal_1/agent-history");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].id).toBe("ar_b");
    expect(res.body[0].recommendation).toBe("second");
    expect(res.body[1].id).toBe("ar_a");
    expect(res.body[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        createdAt: expect.anything(),
        recommendation: expect.any(String),
        nextAction: expect.any(String),
        acceptedByUser: expect.any(Boolean),
      })
    );
  });

  test("non-owner cannot access agent-history", async () => {
    db.agentRuns.push({
      id: "ar_1",
      goalId: "goal_1",
      userId: "user_1",
      evaluation: {},
      failureAnalysis: {},
      recommendation: "x",
      nextAction: "keep_plan",
      rebalancePreview: {},
      acceptedByUser: false,
      createdAt: new Date(),
    });

    const app = createApp();
    const agent = request.agent(app);
    await loginAs(agent, { email: "bob@example.com", password: "ValidPass123!" });

    const res = await agent.get("/goals/goal_1/agent-history");
    expect(res.status).toBe(403);
  });
});
