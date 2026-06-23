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
});

describe("memoryContentSafety", () => {
  test("rejects api keys and tokens", () => {
    expect(validateMemoryContent("sk-abcdefghijklmnopqrstuvwxyz").ok).toBe(false);
    expect(validateMemoryContent("bearer abcdef123456").ok).toBe(false);
  });
});
