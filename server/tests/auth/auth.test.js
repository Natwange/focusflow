const request = require("supertest");
const bcrypt = require("bcrypt");

jest.mock("../../src/lib/sendEmail", () => ({
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
  sendEmailVerificationEmail: jest.fn().mockResolvedValue(undefined),
}));

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  refreshToken: {
    create: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  opaqueAuthToken: {
    create: jest.fn().mockResolvedValue({ id: "ot_1" }),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  task: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    count: jest.fn(),
  },
  goal: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  journalNote: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  focusSession: {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  $transaction: jest.fn(),
};

jest.mock("../../src/lib/prisma", () => mockPrisma);

const { createApp } = require("../../src/app");

describe("Auth + /me API", () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.refreshToken.create.mockResolvedValue({ id: "rt_1" });
  });

  describe("Auth validation", () => {
    test("invalid email returns 400", async () => {
      const res = await request(app).post("/auth/register").send({
        email: "not-an-email",
        password: "ValidPass123!",
        name: "Alice",
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/email/i);
    });

    test("short password returns 400", async () => {
      const res = await request(app).post("/auth/register").send({
        email: "alice@example.com",
        password: "123",
        name: "Alice",
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/password/i);
    });

    test("missing required fields return 400", async () => {
      const res = await request(app).post("/auth/register").send({
        email: "alice@example.com",
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeTruthy();
    });
  });

  describe("Login", () => {
    test("valid login returns success", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "user_1",
        email: "alice@example.com",
        name: "Alice",
        password: "hashed",
        emailVerifiedAt: null,
      });
      jest.spyOn(bcrypt, "compare").mockResolvedValue(true);

      const res = await request(app).post("/auth/login").send({
        email: "alice@example.com",
        password: "ValidPass123!",
      });

      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({
        id: "user_1",
        email: "alice@example.com",
        emailVerified: false,
      });
    });

    test("invalid login returns 401", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "user_1",
        email: "alice@example.com",
        name: "Alice",
        password: "hashed",
        emailVerifiedAt: null,
      });
      jest.spyOn(bcrypt, "compare").mockResolvedValue(false);

      const res = await request(app).post("/auth/login").send({
        email: "alice@example.com",
        password: "WrongPassword",
      });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/invalid credentials/i);
    });

    test("successful login sets HttpOnly cookies", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "user_1",
        email: "alice@example.com",
        name: "Alice",
        password: "hashed",
        emailVerifiedAt: null,
      });
      jest.spyOn(bcrypt, "compare").mockResolvedValue(true);

      const res = await request(app).post("/auth/login").send({
        email: "alice@example.com",
        password: "ValidPass123!",
      });

      expect(res.status).toBe(200);
      const setCookie = res.headers["set-cookie"] || [];
      expect(setCookie.length).toBeGreaterThanOrEqual(2);
      expect(setCookie.some((c) => c.startsWith("access_token="))).toBe(true);
      expect(setCookie.some((c) => c.startsWith("refresh_token="))).toBe(true);
      expect(setCookie.every((c) => /HttpOnly/i.test(c))).toBe(true);
    });
  });

  describe("/me", () => {
    test("unauthenticated request returns 401", async () => {
      const res = await request(app).get("/me");
      expect(res.status).toBe(401);
    });

    test("authenticated request returns 200", async () => {
      mockPrisma.user.findUnique.mockImplementation(async ({ where }) => {
        if (where?.email === "alice@example.com") {
          return {
            id: "user_1",
            email: "alice@example.com",
            name: "Alice",
            password: "hashed",
            emailVerifiedAt: null,
          };
        }
        if (where?.id === "user_1") {
          return {
            id: "user_1",
            email: "alice@example.com",
            name: "Alice",
          };
        }
        return null;
      });
      jest.spyOn(bcrypt, "compare").mockResolvedValue(true);

      const agent = request.agent(app);
      const loginRes = await agent.post("/auth/login").send({
        email: "alice@example.com",
        password: "ValidPass123!",
      });
      expect(loginRes.status).toBe(200);

      const meRes = await agent.get("/me");
      expect(meRes.status).toBe(200);
      expect(meRes.body.user).toMatchObject({
        id: "user_1",
        email: "alice@example.com",
        emailVerified: false,
      });
    });
  });
});
