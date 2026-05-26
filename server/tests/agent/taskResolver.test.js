jest.mock("../../src/lib/prisma", () => {
  const tasks = [
    { id: "t1", userId: "user-a", title: "Study JavaScript", status: "todo" },
    { id: "t2", userId: "user-a", title: "workout", status: "todo" },
    { id: "t3", userId: "user-a", title: "workout", status: "done" },
    { id: "t4", userId: "user-b", title: "Study JavaScript", status: "todo" },
  ];

  return {
    task: {
      findUnique: jest.fn(async ({ where }) => {
        return tasks.find((t) => t.id === where.id) || null;
      }),
      findMany: jest.fn(async ({ where }) => {
        return tasks.filter((t) => {
          if (t.userId !== where.userId) return false;
          if (where.title && typeof where.title === "string") {
            return t.title === where.title;
          }
          if (where.title && where.title.contains) {
            const search = where.title.contains.toLowerCase();
            return t.title.toLowerCase().includes(search);
          }
          return true;
        });
      }),
    },
  };
});

const { resolveTask } = require("../../src/lib/taskResolver");

describe("taskResolver", () => {
  it("resolves by exact ID", async () => {
    const res = await resolveTask("user-a", { taskId: "t1" });
    expect(res.ok).toBe(true);
    expect(res.task.title).toBe("Study JavaScript");
  });

  it("rejects cross-user ID access", async () => {
    const res = await resolveTask("user-a", { taskId: "t4" });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("forbidden");
  });

  it("returns not_found for unknown ID", async () => {
    const res = await resolveTask("user-a", { taskId: "nope" });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("not_found");
  });

  it("resolves by exact title match", async () => {
    const res = await resolveTask("user-a", { taskTitle: "Study JavaScript" });
    expect(res.ok).toBe(true);
    expect(res.task.id).toBe("t1");
  });

  it("returns ambiguous when multiple match by title", async () => {
    const res = await resolveTask("user-a", { taskTitle: "workout" });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("ambiguous");
    expect(res.matches.length).toBe(2);
  });

  it("resolves case-insensitive partial match if exactly one", async () => {
    const res = await resolveTask("user-a", { taskTitle: "JavaScript" });
    expect(res.ok).toBe(true);
    expect(res.task.id).toBe("t1");
  });

  it("returns not_found when no match at all", async () => {
    const res = await resolveTask("user-a", { taskTitle: "nonexistent" });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("not_found");
  });

  it("requires at least taskId or taskTitle", async () => {
    const res = await resolveTask("user-a", {});
    expect(res.ok).toBe(false);
    expect(res.code).toBe("not_found");
  });
});
