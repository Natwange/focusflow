const request = require("supertest");
const bcrypt = require("bcrypt");
const { loginAs } = require("../helpers/authTestHelpers");

const db = {
  users: new Map(),
  goals: new Map(),
  tasks: [],
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
    findMany: jest.fn(async ({ where, select }) => {
      const rows = db.tasks.filter((t) => t.goalId === where.goalId && t.userId === where.userId);
      return rows.map((row) => {
        if (!select) return { ...row };
        const out = {};
        for (const key of Object.keys(select)) {
          if (select[key]) out[key] = row[key];
        }
        return out;
      });
    }),
  },
  journalNote: {},
  focusSession: {},
  $transaction: jest.fn(),
};

jest.mock("../../src/lib/prisma", () => mockPrisma);

const { createApp } = require("../../src/app");

describe("GET /goals/:id/rebalance-recommendation", () => {
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

    db.goals.set("goal_1", {
      id: "goal_1",
      userId: "user_1",
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      deadline: new Date("2026-05-10T00:00:00.000Z"),
      availableDays: [1, 2, 3, 4, 5],
      maxUnitsPerDay: 3,
    });

    db.tasks.push(
      {
        id: "task_1",
        title: "Lesson 1",
        userId: "user_1",
        goalId: "goal_1",
        status: "todo",
        dueDate: new Date("2026-05-03T00:00:00.000Z"),
        unitStart: 1,
        unitEnd: 1,
      },
      {
        id: "task_2",
        title: "Lesson 2",
        userId: "user_1",
        goalId: "goal_1",
        status: "todo",
        dueDate: new Date("2026-05-09T00:00:00.000Z"),
        unitStart: 2,
        unitEnd: 2,
      }
    );
  });

  test("requires auth", async () => {
    const app = createApp();
    const res = await request(app).get("/goals/goal_1/rebalance-recommendation");
    expect(res.status).toBe(401);
  });

  test("returns 403 for non-owner", async () => {
    const app = createApp();
    const agent = request.agent(app);

    const loginRes = await loginAs(agent, {
      email: "bob@example.com",
      password: "ValidPass123!",
    });
    expect(loginRes.status).toBe(200);

    const res = await agent.get("/goals/goal_1/rebalance-recommendation");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Forbidden: goal does not belong to this user");
  });

  test("returns evaluation, failure analysis, and rebalance recommendation for owner", async () => {
    const app = createApp();
    const agent = request.agent(app);

    const loginRes = await loginAs(agent, {
      email: "alice@example.com",
      password: "ValidPass123!",
    });
    expect(loginRes.status).toBe(200);

    const res = await agent.get("/goals/goal_1/rebalance-recommendation");
    expect(res.status).toBe(200);
    expect(res.body.goalId).toBe("goal_1");
    expect(res.body.evaluation).toBeDefined();
    expect(res.body.failureAnalysis).toBeDefined();
    expect(res.body.rebalanceRecommendation).toBeDefined();
    expect(res.body.rebalanceRecommendation).toHaveProperty("canRebalance");
    expect(res.body.rebalanceRecommendation).toHaveProperty("recommendedAction");
    expect(res.body.rebalanceRecommendation).toHaveProperty("proposedSchedule");
    expect(Array.isArray(res.body.rebalanceRecommendation.proposedSchedule)).toBe(true);
  });
});
