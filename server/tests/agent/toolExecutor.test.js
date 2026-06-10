function mockGetTestDb() {
  if (!global.__ffAgentToolDb) {
    global.__ffAgentToolDb = {
      users: new Map(),
      goals: new Map(),
      tasks: [],
      focusSessions: [],
      agentRuns: [],
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
      agentRuns: [],
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
      findMany: jest.fn(async ({ where }) => {
        return [...db.goals.values()].filter((g) => {
          if (where.userId && g.userId !== where.userId) return false;
          return true;
        });
      }),
    },
    task: {
      findUnique: jest.fn(async ({ where }) => {
        return db.tasks.find((t) => t.id === where.id) || null;
      }),
      findMany: jest.fn(async ({ where }) => {
        return db.tasks.filter((t) => {
          if (where.userId && t.userId !== where.userId) return false;
          if (where.OR) return true;
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
          if (where.title) {
            if (typeof where.title === "string") {
              if (t.title !== where.title) return false;
            } else if (where.title.contains) {
              const search = where.title.contains.toLowerCase();
              if (!t.title.toLowerCase().includes(search)) return false;
            }
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
      update: jest.fn(async ({ where, data }) => {
        const task = db.tasks.find((t) => t.id === where.id);
        if (!task) throw new Error("Not found");
        Object.assign(task, data);
        return task;
      }),
      delete: jest.fn(async ({ where }) => {
        const idx = db.tasks.findIndex((t) => t.id === where.id);
        if (idx === -1) throw new Error("Not found");
        const [removed] = db.tasks.splice(idx, 1);
        return removed;
      }),
      count: jest.fn(async ({ where }) => {
        return db.tasks.filter((t) => {
          if (where.userId && t.userId !== where.userId) return false;
          if (where.goalId && t.goalId !== where.goalId) return false;
          return true;
        }).length;
      }),
    },
    $transaction: jest.fn(async (ops) => {
      const results = [];
      for (const op of ops) {
        results.push(await op);
      }
      return results;
    }),
    focusSession: {
      findMany: jest.fn(async ({ where }) => {
        return db.focusSessions.filter((s) => {
          if (where.userId && s.userId !== where.userId) return false;
          if (where.startedAt?.gte && s.startedAt < where.startedAt.gte) return false;
          if (where.startedAt?.lte && s.startedAt > where.startedAt.lte) return false;
          return true;
        });
      }),
    },
    agentRun: {
      findMany: jest.fn(async ({ where }) => {
        return db.agentRuns.filter((r) => {
          if (where.userId && r.userId !== where.userId) return false;
          if (where.createdAt?.gte && r.createdAt < where.createdAt.gte) return false;
          if (where.createdAt?.lte && r.createdAt > where.createdAt.lte) return false;
          return true;
        });
      }),
    },
  };
});

const { executeTool } = require("../../src/agent/toolExecutor");
const { parseToolArgs, V1_TOOL_NAMES } = require("../../src/agent/tools");

describe("agent tools.js", () => {
  it("exports all V1 tool names", () => {
    expect(V1_TOOL_NAMES).toContain("list_tasks");
    expect(V1_TOOL_NAMES).toContain("create_task");
    expect(V1_TOOL_NAMES).toContain("update_task");
    expect(V1_TOOL_NAMES).toContain("complete_task");
    expect(V1_TOOL_NAMES).toContain("delete_task");
    expect(V1_TOOL_NAMES).toContain("get_focus_summary");
    expect(V1_TOOL_NAMES).toContain("get_user_behavior_context");
    expect(V1_TOOL_NAMES).toContain("suggest_focus_session");
    expect(V1_TOOL_NAMES).toContain("create_goal");
    expect(V1_TOOL_NAMES).toContain("preview_goal_plan");
    expect(V1_TOOL_NAMES).toContain("confirm_goal_plan");
    expect(V1_TOOL_NAMES).toContain("list_goals");
    expect(V1_TOOL_NAMES).toContain("get_goal_agent_preview");
    expect(V1_TOOL_NAMES).toContain("apply_goal_rebalance");
    expect(V1_TOOL_NAMES).toContain("preview_goal_adjustment");
    expect(V1_TOOL_NAMES).toContain("apply_goal_adjustment");
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
    db.agentRuns = [];

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
    expect(result.data.pendingConfirmation).toMatchObject({
      type: "confirm_goal_plan",
      goalId: "goal_1",
    });
    expect(result.summary).toMatch(/Plan preview/i);
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

  it("update_task changes title by taskId", async () => {
    const result = await executeTool(ctx, "update_task", {
      taskId: "task_1",
      updates: { title: "Exercise" },
    });
    expect(result.ok).toBe(true);
    expect(result.data.task.title).toBe("Exercise");
    expect(result.summary).toMatch(/renamed to "Exercise"/);
  });

  it("update_task changes due date by title", async () => {
    const result = await executeTool(ctx, "update_task", {
      taskTitle: "Work out",
      updates: { dueDate: "2026-06-01T19:00:00.000Z" },
    });
    expect(result.ok).toBe(true);
    expect(result.summary).toMatch(/due date set to/);
  });

  it("update_task rejects cross-user access", async () => {
    mockGetTestDb().tasks.push({
      id: "task_other",
      userId: "user_2",
      title: "Other task",
      status: "todo",
      priority: "low",
      dueDate: null,
      completedAt: null,
      createdAt: new Date(),
    });
    const result = await executeTool(ctx, "update_task", {
      taskId: "task_other",
      updates: { title: "Hacked" },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/does not belong/);
  });

  it("complete_task marks task done", async () => {
    const result = await executeTool(ctx, "complete_task", {
      taskTitle: "Work out",
    });
    expect(result.ok).toBe(true);
    expect(result.data.task.status).toBe("done");
    expect(result.summary).toMatch(/complete/);
  });

  it("complete_task reports already done", async () => {
    mockGetTestDb().tasks[0].status = "done";
    const result = await executeTool(ctx, "complete_task", {
      taskId: "task_1",
    });
    expect(result.ok).toBe(true);
    expect(result.summary).toMatch(/already/);
  });

  it("delete_task asks confirmation without confirmed flag", async () => {
    const result = await executeTool(ctx, "delete_task", {
      taskTitle: "Work out",
    });
    expect(result.ok).toBe(true);
    expect(result.data.pendingConfirmation).toBeDefined();
    expect(result.data.pendingConfirmation.type).toBe("delete_task");
    expect(result.summary).toMatch(/sure you want to delete/);
    expect(mockGetTestDb().tasks).toHaveLength(1);
  });

  it("delete_task executes with confirmed:true", async () => {
    const result = await executeTool(ctx, "delete_task", {
      taskId: "task_1",
      confirmed: true,
    });
    expect(result.ok).toBe(true);
    expect(result.summary).toMatch(/Deleted/);
    expect(mockGetTestDb().tasks).toHaveLength(0);
  });

  it("delete_task rejects cross-user", async () => {
    mockGetTestDb().tasks.push({
      id: "task_other",
      userId: "user_2",
      title: "Other",
      status: "todo",
      priority: "low",
      dueDate: null,
      completedAt: null,
      createdAt: new Date(),
    });
    const result = await executeTool(ctx, "delete_task", {
      taskId: "task_other",
      confirmed: true,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/does not belong/);
  });

  it("update_task returns ambiguous when multiple tasks match title", async () => {
    mockGetTestDb().tasks.push({
      id: "task_dup",
      userId: "user_1",
      goalId: null,
      title: "Work out",
      status: "doing",
      priority: "low",
      dueDate: null,
      completedAt: null,
      createdAt: new Date(),
    });
    const result = await executeTool(ctx, "update_task", {
      taskTitle: "Work out",
      updates: { status: "done" },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Multiple tasks/);
  });

  it("create_goal creates goal with relative deadline", async () => {
    const result = await executeTool(ctx, "create_goal", {
      title: "Study JavaScript",
      totalUnits: 30,
      deadline: "in 7 days",
      unitName: "lessons",
    });
    expect(result.ok).toBe(true);
    expect(result.data.goal.title).toBe("Study JavaScript");
    expect(result.data.goal.totalUnits).toBe(30);
  });

  it("create_goal rejects invalid deadline", async () => {
    const result = await executeTool(ctx, "create_goal", {
      title: "Bad goal",
      totalUnits: 5,
      deadline: "someday maybe",
    });
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/Invalid deadline/i);
  });

  it("confirm_goal_plan asks confirmation without confirmed flag", async () => {
    const result = await executeTool(ctx, "confirm_goal_plan", { goalId: "goal_1" });
    expect(result.ok).toBe(true);
    expect(result.data.pendingConfirmation.type).toBe("confirm_goal_plan");
    expect(result.summary).toMatch(/confirm/i);
  });

  it("confirm_goal_plan creates tasks when confirmed", async () => {
    const before = mockGetTestDb().tasks.length;
    const result = await executeTool(ctx, "confirm_goal_plan", {
      goalId: "goal_1",
      confirmed: true,
    });
    expect(result.ok).toBe(true);
    expect(result.data.createdCount).toBeGreaterThan(0);
    expect(mockGetTestDb().tasks.length).toBeGreaterThan(before);
  });

  it("confirm_goal_plan blocks duplicate confirm", async () => {
    await executeTool(ctx, "confirm_goal_plan", {
      goalId: "goal_1",
      confirmed: true,
    });
    const second = await executeTool(ctx, "confirm_goal_plan", {
      goalId: "goal_1",
      confirmed: true,
    });
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/already has tasks/i);
  });

  it("confirm_goal_plan forbids cross-user goal", async () => {
    mockGetTestDb().goals.set("goal_other", {
      id: "goal_other",
      userId: "user_2",
      title: "Other",
      totalUnits: 5,
      unitName: "units",
      deadline: new Date(Date.now() + 7 * 86400000),
      availableDays: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
      maxUnitsPerDay: null,
    });
    const result = await executeTool(ctx, "confirm_goal_plan", {
      goalId: "goal_other",
      confirmed: true,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Forbidden|Goal not found/);
  });

  it("rejects invalid create_goal units via Zod", () => {
    const parsed = parseToolArgs("create_goal", {
      title: "X",
      totalUnits: 0,
      deadline: "2026-12-01",
    });
    expect(parsed.ok).toBe(false);
  });

  it("get_user_behavior_context returns summarized signals", async () => {
    const db = mockGetTestDb();
    db.tasks.push(
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `beh_${i}`,
        userId: "user_1",
        status: "done",
        dueDate: new Date("2026-05-13T10:00:00.000Z"),
        completedAt: new Date("2026-05-13T11:00:00.000Z"),
      }))
    );
    db.focusSessions.push({
      userId: "user_1",
      duration: 25,
      startedAt: new Date("2026-05-13T09:00:00.000Z"),
    });

    const result = await executeTool(ctx, "get_user_behavior_context", {
      lookbackDays: 30,
    });

    expect(result.ok).toBe(true);
    expect(result.data.signals.dayOfWeekStats).toHaveLength(7);
    expect(result.data.signals.dataQuality).toBeDefined();
    expect(result.data.signals.dayOfWeekStats[0]).not.toHaveProperty("title");
    expect(result.summary).toMatch(/Behavior context/i);
  });

  it("get_user_behavior_context scopes data to authenticated user", async () => {
    const db = mockGetTestDb();
    db.tasks = [];
    db.focusSessions = [];
    db.agentRuns = [];
    db.tasks.push({
      id: "other_task",
      userId: "user_2",
      status: "done",
      dueDate: new Date("2026-05-13T10:00:00.000Z"),
      completedAt: new Date("2026-05-13T11:00:00.000Z"),
    });

    const result = await executeTool(ctx, "get_user_behavior_context", {});
    expect(result.ok).toBe(true);
    const completed = result.data.signals.dayOfWeekStats.reduce(
      (sum, row) => sum + row.completedTasks,
      0
    );
    expect(completed).toBe(0);
    expect(result.data.signals.dataQuality.hasEnoughData).toBe(false);
  });

  it("behavior analyzer does not mutate create_goal constraints", () => {
    const parsed = parseToolArgs("create_goal", {
      title: "Study JS",
      totalUnits: 30,
      deadline: "in 7 days",
      availableDays: ["MON", "TUE", "WED", "THU", "FRI"],
      maxUnitsPerDay: 2,
    });
    expect(parsed.ok).toBe(true);
    expect(parsed.args.availableDays).toEqual(["MON", "TUE", "WED", "THU", "FRI"]);
    expect(parsed.args.maxUnitsPerDay).toBe(2);
  });
});
