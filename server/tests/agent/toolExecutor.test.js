function mockGetTestDb() {
  if (!global.__ffAgentToolDb) {
    global.__ffAgentToolDb = {
      users: new Map(),
      goals: new Map(),
      tasks: [],
      focusSessions: [],
    };
  }
  return global.__ffAgentToolDb;
}

jest.mock("../../src/lib/prisma", () => {
  if (!global.__ffAgentToolDb) {
    global.__ffAgentToolDb = {
      users: new Map(),
      goals: new Map(),
      tasks: [],
      focusSessions: [],
    };
  }
  const db = global.__ffAgentToolDb;
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
          if (where.dueDate?.gte && (!t.dueDate || t.dueDate < where.dueDate.gte))
            return false;
          if (where.dueDate?.lte && (!t.dueDate || t.dueDate > where.dueDate.lte))
            return false;
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
  };
});

const { executeTool } = require("../../src/agent/toolExecutor");
const { parseToolArgs, V1_TOOL_NAMES } = require("../../src/agent/tools");

describe("agent tools.js", () => {
  it("exports five V1 tool names", () => {
    expect(V1_TOOL_NAMES).toEqual([
      "list_tasks",
      "create_task",
      "get_focus_summary",
      "suggest_focus_session",
      "preview_goal_plan",
    ]);
  });

  it("rejects invalid create_task args", () => {
    const parsed = parseToolArgs("create_task", { title: "" });
    expect(parsed.ok).toBe(false);
  });
});

describe("agent toolExecutor", () => {
  const ctx = { userId: "user_1", tzOffsetMinutes: 0 };

  beforeEach(() => {
    jest.clearAllMocks();
    const db = mockGetTestDb();
    db.users.clear();
    db.goals.clear();
    db.tasks = [];
    db.focusSessions = [];

    db.users.set("user_1", {
      id: "user_1",
      streakCount: 3,
      streakDateKey: "2026-05-23",
    });

    const deadline = new Date();
    deadline.setDate(deadline.getDate() + 14);
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

    db.tasks.push({
      id: "task_1",
      userId: "user_1",
      goalId: null,
      title: "Work out",
      status: "todo",
      priority: "medium",
      dueDate: new Date("2026-05-24T15:00:00.000Z"),
      completedAt: null,
      createdAt: new Date(),
    });
  });

  it("list_tasks returns tasks for the user", async () => {
    const result = await executeTool(ctx, "list_tasks", {});
    expect(result.ok).toBe(true);
    expect(result.data.count).toBe(1);
    expect(result.summary).toMatch(/Found 1 task/);
  });

  it("create_task creates a task scoped to user", async () => {
    const result = await executeTool(ctx, "create_task", {
      title: "Read chapter 2",
      dueDate: "2026-05-25T11:00:00.000Z",
      priority: "high",
    });
    expect(result.ok).toBe(true);
    expect(result.data.task.title).toBe("Read chapter 2");
    expect(mockGetTestDb().tasks).toHaveLength(2);
  });

  it("create_task rejects another user's goal", async () => {
    mockGetTestDb().goals.set("goal_other", {
      id: "goal_other",
      userId: "user_2",
      title: "Other",
      totalUnits: 5,
      unitName: "units",
      deadline: new Date(),
      availableDays: ["MON"],
      maxUnitsPerDay: null,
    });

    const result = await executeTool(ctx, "create_task", {
      title: "Bad link",
      goalId: "goal_other",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Forbidden|Goal not found/);
  });

  it("get_focus_summary returns minutes and streak", async () => {
    const now = new Date();
    mockGetTestDb().focusSessions.push({
      userId: "user_1",
      duration: 30,
      startedAt: now,
    });

    const result = await executeTool(ctx, "get_focus_summary", {
      tzOffsetMinutes: 0,
    });
    expect(result.ok).toBe(true);
    expect(result.data.todayMinutes).toBe(30);
    expect(result.data.streak).toBe(3);
  });

  it("suggest_focus_session returns client action only", async () => {
    const result = await executeTool(ctx, "suggest_focus_session", {
      mode: "focus",
      durationMinutes: 25,
    });
    expect(result.ok).toBe(true);
    expect(result.data.clientAction).toEqual({
      type: "start_focus_session",
      mode: "focus",
      durationMinutes: 25,
      label: null,
    });
    expect(mockGetTestDb().focusSessions).toHaveLength(0);
  });

  it("preview_goal_plan returns items without writing tasks", async () => {
    const before = mockGetTestDb().tasks.length;
    const result = await executeTool(ctx, "preview_goal_plan", {
      goalId: "goal_1",
    });
    expect(result.ok).toBe(true);
    expect(Array.isArray(result.data.items)).toBe(true);
    expect(result.data.items.length).toBeGreaterThan(0);
    expect(result.summary).toMatch(/Preview only/);
    expect(mockGetTestDb().tasks).toHaveLength(before);
  });

  it("preview_goal_plan forbids cross-user goal", async () => {
    const result = await executeTool(ctx, "preview_goal_plan", {
      goalId: "goal_other",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Goal not found|Forbidden/);
  });

  it("rejects unknown tool", async () => {
    const result = await executeTool(ctx, "delete_everything", {});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Unknown tool/);
  });
});
