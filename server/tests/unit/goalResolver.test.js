const {
  resolveGoal,
  looksLikeInventedSlug,
  normalizeGoalLookupArgs,
  scoreGoalTitleMatch,
} = require("../../src/lib/goalResolver");

function mockDb() {
  if (!global.__ffGoalResolverDb) {
    global.__ffGoalResolverDb = { goals: new Map() };
  }
  return global.__ffGoalResolverDb;
}

jest.mock("../../src/lib/prisma", () => {
  if (!global.__ffGoalResolverDb) {
    global.__ffGoalResolverDb = { goals: new Map() };
  }
  const db = global.__ffGoalResolverDb;
  return {
    goal: {
      findUnique: jest.fn(async ({ where }) => db.goals.get(where.id) || null),
      findMany: jest.fn(async ({ where }) =>
        [...db.goals.values()].filter((g) => {
          if (where.userId && g.userId !== where.userId) return false;
          if (where.title && g.title !== where.title) return false;
          if (where.title?.contains) {
            const search = where.title.contains.toLowerCase();
            if (!g.title.toLowerCase().includes(search)) return false;
          }
          return true;
        })
      ),
    },
  };
});

describe("goalResolver", () => {
  beforeEach(() => {
    const db = mockDb();
    db.goals.clear();
    db.goals.set("goal_real", {
      id: "goal_real",
      userId: "user_1",
      title: "Study Human Anatomy",
    });
    db.goals.set("goal_js", {
      id: "goal_js",
      userId: "user_1",
      title: "Learn JavaScript",
    });
  });

  test("looksLikeInventedSlug detects hyphen and underscore slugs", () => {
    expect(looksLikeInventedSlug("learn-human-anatomy")).toBe(true);
    expect(looksLikeInventedSlug("study_human_anatomy")).toBe(true);
    expect(looksLikeInventedSlug("goal_1")).toBe(false);
    expect(looksLikeInventedSlug("clxyz123abc456def789012")).toBe(false);
  });

  test("normalizeGoalLookupArgs rewrites slugs to goalTitle", () => {
    expect(normalizeGoalLookupArgs({ goalId: "learn-human-anatomy" })).toEqual({
      goalTitle: "learn human anatomy",
    });
    expect(normalizeGoalLookupArgs({ goalId: "study_human_anatomy" })).toEqual({
      goalTitle: "study human anatomy",
    });
  });

  test("human anatomy matches Study Human Anatomy via contains", async () => {
    const result = await resolveGoal("user_1", { goalTitle: "human anatomy" });
    expect(result.ok).toBe(true);
    expect(result.goal.title).toBe("Study Human Anatomy");
    expect(["containsTitle", "wordMatch"]).toContain(result.matchedFrom);
  });

  test("resolves slug goalId by matching title words", async () => {
    const result = await resolveGoal("user_1", { goalId: "study-human-anatomy" });
    expect(result.ok).toBe(true);
    expect(result.goal.title).toBe("Study Human Anatomy");
  });

  test("word match picks best goal when phrase is partial", async () => {
    const result = await resolveGoal("user_1", { goalTitle: "javascript" });
    expect(result.ok).toBe(true);
    expect(result.goal.title).toBe("Learn JavaScript");
  });

  test("scoreGoalTitleMatch ranks multi-word phrase over unrelated goal", () => {
    const anatomy = scoreGoalTitleMatch("human anatomy", "Study Human Anatomy");
    const js = scoreGoalTitleMatch("human anatomy", "Learn JavaScript");
    expect(anatomy.score).toBeGreaterThan(js.score);
  });
});
