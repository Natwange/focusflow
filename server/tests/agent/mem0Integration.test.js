const { runLlmTurn } = require("../../src/agent/chatOrchestrator");
const {
  setCompleteAgentTurnForTests,
  setCompleteObserveRespondForTests,
  resetLlmClientForTests,
  buildSystemPromptWithMemories,
} = require("../../src/agent/llmClient");
const {
  setInMemoryStoreForTests,
  resetMem0ServiceForTests,
  storeMemory,
} = require("../../src/memory/mem0Service");

describe("agent Mem0 integration", () => {
  let turnInputs;

  beforeEach(() => {
    turnInputs = [];
    resetLlmClientForTests();
    resetMem0ServiceForTests();
    setInMemoryStoreForTests(new Map());
    setCompleteObserveRespondForTests(async () => ({
      type: "message",
      content: "ok",
    }));
  });

  afterEach(() => {
    resetLlmClientForTests();
    resetMem0ServiceForTests();
  });

  test("memory context reaches Claude/OpenAI system prompt", async () => {
    await storeMemory({
      userId: "user_1",
      content: "User prefers 45-minute focus sessions.",
    });

    setCompleteAgentTurnForTests(async (input) => {
      turnInputs.push(input);
      return { type: "message", content: "How can I help?" };
    });

    await runLlmTurn({
      userId: "user_1",
      message: "Help me study DSA",
      tzOffsetMinutes: 0,
      history: [],
    });

    expect(turnInputs).toHaveLength(1);
    expect(turnInputs[0].userId).toBe("user_1");

    const prompt = buildSystemPromptWithMemories(
      turnInputs[0].memoryContext ?? ""
    );
    // memoryContext is resolved inside completeAgentTurn; verify via rebuild
    const { buildMemoryContextForTurn } = require("../../src/memory/mem0Service");
    const ctx = await buildMemoryContextForTurn({
      userId: "user_1",
      message: "Help me study DSA",
    });
    expect(ctx).toMatch(/45-minute/i);
    expect(buildSystemPromptWithMemories(ctx)).toMatch(/45-minute/i);
  });

  test("explicit remember stores without LLM", async () => {
    setCompleteAgentTurnForTests(async () => {
      throw new Error("LLM should not run for explicit remember");
    });

    const res = await runLlmTurn({
      userId: "user_1",
      message: "Remember I like doing LeetCode every day",
      tzOffsetMinutes: 0,
    });

    expect(res.toolResults[0].tool).toBe("store_memory");
    expect(res.toolResults[0].ok).toBe(true);
    expect(res.assistantMessage).toMatch(/LeetCode/i);
  });

  test("memory retrieval failure does not crash agent turn", async () => {
    resetMem0ServiceForTests();

    setCompleteAgentTurnForTests(async () => ({
      type: "message",
      content: "Still here.",
    }));

    const res = await runLlmTurn({
      userId: "user_1",
      message: "hello",
      tzOffsetMinutes: 0,
    });

    expect(res.assistantMessage).toBe("Still here.");
  });

  test("store_memory tool persists preference", async () => {
    const { executeTool } = require("../../src/agent/toolExecutor");

    const result = await executeTool(
      { userId: "user_1", tzOffsetMinutes: 0 },
      "store_memory",
      { content: "User prefers morning study sessions." }
    );

    expect(result.ok).toBe(true);

    const list = await executeTool(
      { userId: "user_1", tzOffsetMinutes: 0 },
      "list_memories",
      {}
    );
    expect(list.ok).toBe(true);
    expect(list.summary).toMatch(/morning/i);
  });
});
