const request = require("supertest");
const bcrypt = require("bcrypt");
const { hashRefreshToken } = require("../../src/lib/authTokens");
const { loginAs, sleepMs } = require("../helpers/authTestHelpers");

jest.mock("../../src/lib/sendEmail", () => ({
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
  sendEmailVerificationEmail: jest.fn().mockResolvedValue(undefined),
}));

const db = {
  users: new Map(),
  tasks: new Map(),
  refreshTokens: new Map(),
};

let seq = 1;

function nextId(prefix) {
  const id = `${prefix}_${seq}`;
  seq += 1;
  return id;
}

function pick(record, select) {
  if (!record) return null;
  if (!select) return { ...record };
  const out = {};
  for (const [k, shouldInclude] of Object.entries(select)) {
    if (shouldInclude) out[k] = record[k];
  }
  return out;
}

const mockPrisma = {
  user: {
    findUnique: jest.fn(async ({ where, select }) => {
      let record = null;
      if (where?.id) {
        record = db.users.get(where.id) || null;
      } else if (where?.email) {
        record = [...db.users.values()].find((u) => u.email === where.email) || null;
      }
      return pick(record, select);
    }),
    create: jest.fn(async ({ data, select }) => {
      const now = new Date();
      const created = {
        id: nextId("user"),
        email: data.email,
        password: data.password,
        name: data.name || "",
        emailVerifiedAt: data.emailVerifiedAt ?? null,
        createdAt: now,
        updatedAt: now,
      };
      db.users.set(created.id, created);
      return pick(created, select);
    }),
    update: jest.fn(async ({ where, data, select }) => {
      const prev = db.users.get(where.id);
      if (!prev) throw new Error("User not found");
      const updated = { ...prev, ...data, updatedAt: new Date() };
      db.users.set(updated.id, updated);
      return pick(updated, select);
    }),
  },
  refreshToken: {
    create: jest.fn(async ({ data }) => {
      const created = {
        id: nextId("rt"),
        userId: data.userId,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
        createdAt: new Date(),
      };
      db.refreshTokens.set(created.id, created);
      return created;
    }),
    findUnique: jest.fn(async ({ where }) => {
      if (where?.tokenHash) {
        return [...db.refreshTokens.values()].find((t) => t.tokenHash === where.tokenHash) || null;
      }
      if (where?.id) {
        return db.refreshTokens.get(where.id) || null;
      }
      return null;
    }),
    delete: jest.fn(async ({ where }) => {
      if (where?.id && db.refreshTokens.has(where.id)) {
        const value = db.refreshTokens.get(where.id);
        db.refreshTokens.delete(where.id);
        return value;
      }
      throw new Error("Refresh token not found");
    }),
    deleteMany: jest.fn(async ({ where }) => {
      let count = 0;
      for (const [id, token] of [...db.refreshTokens.entries()]) {
        const byHash =
          where?.tokenHash && token.tokenHash === where.tokenHash;
        const byUser = where?.userId && token.userId === where.userId;
        if (byHash || byUser) {
          db.refreshTokens.delete(id);
          count += 1;
        }
      }
      return { count };
    }),
  },
  opaqueAuthToken: {
    create: jest.fn().mockResolvedValue({ id: "oat_1" }),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  task: {
    create: jest.fn(async ({ data, select }) => {
      const created = {
        id: nextId("task"),
        userId: data.userId,
        goalId: data.goalId ?? null,
        title: data.title,
        estimatedMin: data.estimatedMin ?? null,
        priority: data.priority || "medium",
        status: data.status || "todo",
        dueDate: data.dueDate ?? null,
        completedAt: data.completedAt ?? null,
        createdAt: new Date(),
      };
      db.tasks.set(created.id, created);
      return pick(created, select);
    }),
    findMany: jest.fn(async ({ where }) => {
      return [...db.tasks.values()].filter((task) => {
        if (where?.userId && task.userId !== where.userId) return false;
        if (where?.goalId && task.goalId !== where.goalId) return false;
        if (where?.status && task.status !== where.status) return false;
        return true;
      });
    }),
    findUnique: jest.fn(async ({ where, select }) => {
      const task = db.tasks.get(where.id) || null;
      return pick(task, select);
    }),
    findFirst: jest.fn(async ({ where, select }) => {
      const found =
        [...db.tasks.values()].find((task) => {
          if (where?.id && task.id !== where.id) return false;
          if (where?.userId && task.userId !== where.userId) return false;
          if (where?.goalId && task.goalId !== where.goalId) return false;
          return true;
        }) || null;
      return pick(found, select);
    }),
    update: jest.fn(async ({ where, data, select }) => {
      const prev = db.tasks.get(where.id);
      if (!prev) throw new Error("Task not found");
      const updated = { ...prev, ...data };
      db.tasks.set(updated.id, updated);
      return pick(updated, select);
    }),
    delete: jest.fn(async ({ where }) => {
      const prev = db.tasks.get(where.id);
      if (!prev) throw new Error("Task not found");
      db.tasks.delete(where.id);
      return prev;
    }),
    deleteMany: jest.fn(async ({ where }) => {
      let count = 0;
      for (const [id, task] of db.tasks.entries()) {
        if (where?.userId && task.userId !== where.userId) continue;
        if (where?.goalId && task.goalId !== where.goalId) continue;
        db.tasks.delete(id);
        count += 1;
      }
      return { count };
    }),
    count: jest.fn(async ({ where }) => {
      const rows = await mockPrisma.task.findMany({ where });
      return rows.length;
    }),
  },
  goal: {
    findUnique: jest.fn(async ({ where, select }) => {
      if (!where?.id) return null;
      return null;
    }),
    findFirst: jest.fn(async () => null),
    findMany: jest.fn(async () => []),
    create: jest.fn(async () => ({})),
    update: jest.fn(async () => ({})),
    delete: jest.fn(async () => ({})),
  },
  journalNote: {
    findUnique: jest.fn(async () => null),
    findFirst: jest.fn(async () => null),
    findMany: jest.fn(async () => []),
    create: jest.fn(async () => ({})),
    update: jest.fn(async () => ({})),
    delete: jest.fn(async () => ({})),
  },
  focusSession: {
    create: jest.fn(async () => ({})),
    findMany: jest.fn(async () => []),
    count: jest.fn(async () => 0),
  },
  $transaction: jest.fn(async (callback) => callback(mockPrisma)),
};

jest.mock("../../src/lib/prisma", () => mockPrisma);

const { createApp } = require("../../src/app");

function resetDb() {
  db.users.clear();
  db.tasks.clear();
  db.refreshTokens.clear();
  seq = 1;
  jest.clearAllMocks();
}

async function seedUser({ id, email, password, name = "Test User" }) {
  const hashed = await bcrypt.hash(password, 10);
  const user = {
    id,
    email,
    password: hashed,
    name,
    emailVerifiedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  db.users.set(id, user);
  return user;
}

const { resetAuthRateLimiters } = require("../../src/lib/authRateLimits");
const { resetLoginFailureLimiter } = require("../../src/lib/loginFailureLimiter");

describe("Security-critical integration flows", () => {
  let app;

  beforeEach(() => {
    resetDb();
    resetAuthRateLimiters();
    resetLoginFailureLimiter();
    process.env.JWT_SECRET = "test-jwt-secret";
    process.env.JWT_ACCESS_EXPIRES_IN = "1s";
    process.env.AUTH_RATE_LIMIT_MAX = "4";
    process.env.LOGIN_RATE_LIMIT_MAX = "4";
    process.env.REGISTER_RATE_LIMIT_MAX = "4";
    process.env.FORGOT_PASSWORD_RATE_LIMIT_MAX = "4";
    delete process.env.DISABLE_AUTH_RATE_LIMIT;
    app = createApp();
  });

  describe("Refresh token flow", () => {
    test("login -> access expires -> refresh succeeds -> protected request succeeds", async () => {
      await seedUser({
        id: "user_1",
        email: "alice@example.com",
        password: "ValidPass123!",
      });

      const agent = request.agent(app);
      const loginRes = await loginAs(agent, {
        email: "alice@example.com",
        password: "ValidPass123!",
      });
      expect(loginRes.status).toBe(200);

      await sleepMs(1200);

      const protectedBeforeRefresh = await agent.get("/tasks");
      expect(protectedBeforeRefresh.status).toBe(401);

      const refreshRes = await agent.post("/auth/refresh");
      expect(refreshRes.status).toBe(200);

      const protectedAfterRefresh = await agent.get("/tasks");
      expect(protectedAfterRefresh.status).toBe(200);
    });

    test("missing refresh token after access expiry leads to 401", async () => {
      await seedUser({
        id: "user_1",
        email: "alice@example.com",
        password: "ValidPass123!",
      });

      const agent = request.agent(app);
      const loginRes = await loginAs(agent, {
        email: "alice@example.com",
        password: "ValidPass123!",
      });
      expect(loginRes.status).toBe(200);

      const refreshCookie = (loginRes.headers["set-cookie"] || []).find((c) =>
        c.startsWith("refresh_token=")
      );
      const refreshValue = refreshCookie?.split(";")[0].split("=")[1];
      expect(refreshValue).toBeTruthy();

      const tokenHash = hashRefreshToken(refreshValue);
      for (const [id, token] of db.refreshTokens.entries()) {
        if (token.tokenHash === tokenHash) {
          db.refreshTokens.delete(id);
        }
      }

      await sleepMs(1200);

      const protectedRes = await agent.get("/tasks");
      expect(protectedRes.status).toBe(401);

      const refreshRes = await agent.post("/auth/refresh");
      expect(refreshRes.status).toBe(401);
    });
  });

  describe("Ownership checks", () => {
    test("User B cannot update/delete User A task", async () => {
      await seedUser({
        id: "user_a",
        email: "a@example.com",
        password: "ValidPass123!",
      });
      await seedUser({
        id: "user_b",
        email: "b@example.com",
        password: "ValidPass123!",
      });

      const agentA = request.agent(app);
      const agentB = request.agent(app);

      await loginAs(agentA, { email: "a@example.com", password: "ValidPass123!" });
      await loginAs(agentB, { email: "b@example.com", password: "ValidPass123!" });

      const createRes = await agentA.post("/tasks").send({
        title: "User A private task",
        priority: "medium",
      });
      expect(createRes.status).toBe(201);
      const taskId = createRes.body.id;

      const listResB = await agentB.get("/tasks");
      expect(listResB.status).toBe(200);
      expect(listResB.body.some((t) => t.id === taskId)).toBe(false);

      const updateResB = await agentB.patch(`/tasks/${taskId}`).send({ title: "hacked" });
      expect([403, 404]).toContain(updateResB.status);

      const deleteResB = await agentB.delete(`/tasks/${taskId}`);
      expect([403, 404]).toContain(deleteResB.status);
    });
  });

  describe("Task validation", () => {
    test("invalid priority returns 400", async () => {
      await seedUser({
        id: "user_1",
        email: "alice@example.com",
        password: "ValidPass123!",
      });
      const agent = request.agent(app);
      await loginAs(agent, { email: "alice@example.com", password: "ValidPass123!" });

      const res = await agent.post("/tasks").send({
        title: "Do something",
        priority: "super-high",
      });

      expect(res.status).toBe(400);
    });

    test("empty title returns 400", async () => {
      await seedUser({
        id: "user_1",
        email: "alice@example.com",
        password: "ValidPass123!",
      });
      const agent = request.agent(app);
      await loginAs(agent, { email: "alice@example.com", password: "ValidPass123!" });

      const res = await agent.post("/tasks").send({
        title: "",
        priority: "medium",
      });

      expect(res.status).toBe(400);
    });

    test("valid task returns 201", async () => {
      await seedUser({
        id: "user_1",
        email: "alice@example.com",
        password: "ValidPass123!",
      });
      const agent = request.agent(app);
      await loginAs(agent, { email: "alice@example.com", password: "ValidPass123!" });

      const res = await agent.post("/tasks").send({
        title: "Write tests",
        priority: "high",
      });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        title: "Write tests",
        priority: "high",
      });
    });
  });

  describe("Rate limiting", () => {
    test("multiple rapid login requests hit 429 after threshold", async () => {
      await seedUser({
        id: "user_1",
        email: "alice@example.com",
        password: "ValidPass123!",
      });

      const results = [];
      for (let i = 0; i < 6; i += 1) {
        results.push(
          await request(app).post("/auth/login").send({
            email: "alice@example.com",
            password: "WrongPassword",
          })
        );
      }
      expect(results.some((r) => r.status === 429)).toBe(true);
    });

    test("login rate limit does not block register for the same email", async () => {
      for (let i = 0; i < 4; i += 1) {
        await request(app).post("/auth/login").send({
          email: "newuser@example.com",
          password: "WrongPassword",
        });
      }

      const registerRes = await request(app).post("/auth/register").send({
        email: "newuser@example.com",
        password: "ValidPass123!",
        name: "New User",
      });
      expect(registerRes.status).toBe(201);
    });

    test("login rate limit is scoped per email even when IP is identical", async () => {
      await seedUser({
        id: "user_1",
        email: "alice@example.com",
        password: "ValidPass123!",
      });
      await seedUser({
        id: "user_2",
        email: "bob@example.com",
        password: "ValidPass123!",
      });

      const sharedIp = "203.0.113.50";
      for (let i = 0; i < 5; i += 1) {
        await request(app)
          .post("/auth/login")
          .set("X-Forwarded-For", sharedIp)
          .send({
            email: "alice@example.com",
            password: "WrongPassword",
          });
      }

      const bobLogin = await request(app)
        .post("/auth/login")
        .set("X-Forwarded-For", sharedIp)
        .send({
          email: "bob@example.com",
          password: "ValidPass123!",
        });
      expect(bobLogin.status).toBe(200);
    });

    test("login rate limit is scoped per email, not shared across users", async () => {
      await seedUser({
        id: "user_1",
        email: "alice@example.com",
        password: "ValidPass123!",
      });
      await seedUser({
        id: "user_2",
        email: "bob@example.com",
        password: "ValidPass123!",
      });

      for (let i = 0; i < 5; i += 1) {
        await request(app).post("/auth/login").send({
          email: "alice@example.com",
          password: "WrongPassword",
        });
      }

      const bobLogin = await request(app).post("/auth/login").send({
        email: "bob@example.com",
        password: "ValidPass123!",
      });
      expect(bobLogin.status).toBe(200);
    });
  });
});
