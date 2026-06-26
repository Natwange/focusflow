const {
  validateMemoryContent,
} = require("../../src/memory/memoryContentSafety");
const {
  extractPreferenceMemoriesFromText,
  isGenericTaskRequest,
  isTransientState,
} = require("../../src/memory/memoryExtraction");
const {
  retrieveRelevantMemories,
  storeMemory,
  listMemories,
  deleteMemory,
  deleteMemoriesByQuery,
  formatMemoriesForPrompt,
  filterByConfidence,
  buildMemoryContextForTurn,
  maybeAutoExtractAndStore,
  setInMemoryStoreForTests,
  resetMem0ServiceForTests,
  setMem0ClientForTests,
  toMem0UserId,
  buildMem0EntityFilters,
  filterMemoriesForUser,
  rememberUserPreference,
  storeMemoryInferred,
} = require("../../src/memory/mem0Service");

describe("mem0Service", () => {
  beforeEach(() => {
    resetMem0ServiceForTests();
    setInMemoryStoreForTests(new Map());
  });

  afterEach(() => {
    resetMem0ServiceForTests();
  });

  test("stores and retrieves user-scoped memory", async () => {
    const stored = await storeMemory({
      userId: "user_a",
      content: "User prefers 45-minute focus sessions.",
    });
    expect(stored.ok).toBe(true);

    const memories = await retrieveRelevantMemories({
      userId: "user_a",
      query: "focus session length",
      limit: 5,
    });
    expect(memories.length).toBeGreaterThan(0);
    expect(memories[0].content).toMatch(/45-minute/i);
  });

  test("memories are isolated per user", async () => {
    await storeMemory({
      userId: "user_a",
      content: "User prefers mornings.",
    });
    await storeMemory({
      userId: "user_b",
      content: "User prefers nights.",
    });

    const a = await listMemories({ userId: "user_a" });
    const b = await listMemories({ userId: "user_b" });

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].content).toMatch(/morning/i);
    expect(b[0].content).toMatch(/night/i);
  });

  test("toMem0UserId namespaces FocusFlow users for Mem0", () => {
    expect(toMem0UserId("clxyz123")).toBe("focusflow:clxyz123");
    expect(buildMem0EntityFilters("clxyz123")).toEqual({
      OR: [{ user_id: "focusflow:clxyz123" }, { user_id: "clxyz123" }],
    });
  });

  test("filterMemoriesForUser drops records without owner or wrong owner", () => {
    const scoped = toMem0UserId("user_a");
    const kept = filterMemoriesForUser(
      [
        { id: "1", content: "mine", user_id: scoped },
        { id: "2", content: "orphan" },
        { id: "3", content: "theirs", user_id: toMem0UserId("user_b") },
      ],
      "user_a"
    );
    expect(kept).toHaveLength(1);
    expect(kept[0].content).toBe("mine");
  });

  test("listMemories passes scoped filters to Mem0 client", async () => {
    const savedKey = process.env.MEM0_API_KEY;
    resetMem0ServiceForTests();
    setInMemoryStoreForTests(null);

    const calls = [];
    setMem0ClientForTests({
      getAll: async (options) => {
        calls.push(options);
        return {
          results: [
            {
              id: "m1",
              memory: "User prefers mornings.",
              user_id: toMem0UserId("user_a"),
            },
            {
              id: "m2",
              memory: "User prefers nights.",
              user_id: toMem0UserId("user_b"),
            },
          ],
        };
      },
    });

    const memories = await listMemories({ userId: "user_a", limit: 10 });
    expect(calls[0].filters).toEqual(buildMem0EntityFilters("user_a"));
    expect(memories).toHaveLength(1);
    expect(memories[0].content).toMatch(/morning/i);

    if (savedKey) process.env.MEM0_API_KEY = savedKey;
    else delete process.env.MEM0_API_KEY;
  });

  test("delete memory works", async () => {
    const stored = await storeMemory({
      userId: "user_a",
      content: "User avoids weekends.",
    });
    const deleted = await deleteMemory({
      userId: "user_a",
      memoryId: stored.memory.id,
    });
    expect(deleted.ok).toBe(true);
    expect(await listMemories({ userId: "user_a" })).toHaveLength(0);
  });

  test("delete by query removes matching memories", async () => {
    await storeMemory({
      userId: "user_a",
      content: "User prefers studying on weekends.",
    });
    const result = await deleteMemoriesByQuery({
      userId: "user_a",
      query: "weekends",
    });
    expect(result.ok).toBe(true);
    expect(result.deleted.length).toBeGreaterThan(0);
  });

  test("retrieval failure does not throw", async () => {
    resetMem0ServiceForTests();
    setInMemoryStoreForTests(null);
    setMem0ClientForTests({
      search: async () => {
        throw new Error("Mem0 unavailable");
      },
    });

    const memories = await retrieveRelevantMemories({
      userId: "user_a",
      query: "anything",
    });
    expect(memories).toEqual([]);
  });

  test("rejects secrets in memory content", async () => {
    const result = await storeMemory({
      userId: "user_a",
      content: "My password is hunter2",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/secret|password/i);
  });

  test("low-confidence memories are filtered from prompt", () => {
    const filtered = filterByConfidence(
      [
        { content: "high", score: 0.9 },
        { content: "low", score: 0.1 },
      ],
      0.35
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].content).toBe("high");
  });

  test("formatMemoriesForPrompt includes soft-context disclaimer", () => {
    const text = formatMemoriesForPrompt([{ content: "User prefers mornings." }]);
    expect(text).toMatch(/Relevant memories/i);
    expect(text).toMatch(/morning/i);
    expect(text).toMatch(/never override/i);
  });

  test("buildMemoryContextForTurn returns empty when no memories", async () => {
    const ctx = await buildMemoryContextForTurn({
      userId: "user_a",
      message: "help me study",
    });
    expect(ctx).toBe("");
  });

  test("auto extraction stores rule-based preferences", async () => {
    await maybeAutoExtractAndStore({
      userId: "user_a",
      userMessage: "I like 45 minute focus sessions",
      assistantMessage: "Got it!",
      toolResults: [],
    });

    const memories = await listMemories({ userId: "user_a" });
    expect(memories.some((m) => /45-minute/i.test(m.content))).toBe(true);
  });

  test("auto extraction skips generic task requests", async () => {
    await maybeAutoExtractAndStore({
      userId: "user_a",
      userMessage: "Create a task for groceries",
      assistantMessage: "Done.",
      toolResults: [],
    });
    expect(await listMemories({ userId: "user_a" })).toHaveLength(0);
  });

  test("rememberUserPreference uses literal path for simple phrases", async () => {
    const result = await rememberUserPreference({
      userId: "user_a",
      message: "Remember that I prefer 45-minute focus sessions.",
    });
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("literal");
    expect(result.memory.content).toMatch(/45-minute/i);
  });

  test("rememberUserPreference uses infer path when regex cannot extract", async () => {
    const inferCalls = [];
    resetMem0ServiceForTests();
    setMem0ClientForTests({
      add: async (messages, options) => {
        inferCalls.push({ messages, options });
        return { status: "PENDING", eventId: "evt_1" };
      },
    });

    const result = await rememberUserPreference({
      userId: "user_a",
      message: "save this preference",
    });

    expect(result.ok).toBe(true);
    expect(result.mode).toBe("infer");
    expect(result.pending).toBe(true);
    expect(inferCalls).toHaveLength(1);
    expect(inferCalls[0].options.infer).toBe(true);
    expect(inferCalls[0].messages[0].content).toMatch(/save this preference/i);
  });
});

describe("memoryExtraction", () => {
  test("extracts remember-that commands", () => {
    const memories = extractPreferenceMemoriesFromText(
      "Remember that I like 45-minute focus sessions."
    );
    expect(memories[0]).toMatch(/45-minute/i);
  });

  test("extractExplicitRememberContent handles remember without that", () => {
    const { extractExplicitRememberContent } = require("../../src/memory/memoryExtraction");
    const content = extractExplicitRememberContent(
      "Remember I like doing LeetCode every day"
    );
    expect(content).toMatch(/LeetCode/i);
  });

  test("ignores transient states", () => {
    expect(isTransientState("I'm tired today")).toBe(true);
    expect(extractPreferenceMemoriesFromText("I'm tired today")).toEqual([]);
  });

  test("ignores generic task creation", () => {
    expect(isGenericTaskRequest("Add a task for laundry")).toBe(true);
  });

  test("recall questions are not treated as remember commands", () => {
    const {
      isExplicitRememberRequest,
      isMemoryRecallRequest,
      extractExplicitRememberContent,
    } = require("../../src/memory/memoryExtraction");

    expect(isMemoryRecallRequest("what do you remember about me?")).toBe(true);
    expect(isMemoryRecallRequest("what do you know about me?")).toBe(true);
    expect(isMemoryRecallRequest("list what you remember about me")).toBe(true);
    expect(isExplicitRememberRequest("what do you remember about me?")).toBe(false);
    expect(
      extractExplicitRememberContent("what do you remember about me?")
    ).toBeNull();
  });

  test("rejects junk remember fragments", () => {
    const { extractExplicitRememberContent } = require("../../src/memory/memoryExtraction");
    expect(extractExplicitRememberContent("remember about me")).toBeNull();
  });

  test("resolveRememberStoragePlan uses infer when regex cannot extract", () => {
    const { resolveRememberStoragePlan } = require("../../src/memory/memoryExtraction");
    const plan = resolveRememberStoragePlan("save this preference");
    expect(plan.mode).toBe("infer");
  });

  test("resolveRememberStoragePlan uses literal for simple remember-that", () => {
    const { resolveRememberStoragePlan } = require("../../src/memory/memoryExtraction");
    const plan = resolveRememberStoragePlan(
      "Remember that I like 30-minute focus sessions."
    );
    expect(plan.mode).toBe("literal");
    expect(plan.content).toMatch(/30-minute/i);
  });
});

describe("memoryContentSafety", () => {
  test("rejects api keys and tokens", () => {
    expect(validateMemoryContent("sk-abcdefghijklmnopqrstuvwxyz").ok).toBe(false);
    expect(validateMemoryContent("bearer abcdef123456").ok).toBe(false);
  });
});
