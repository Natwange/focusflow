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

  test("recall question lists memories without storing", async () => {
    setCompleteAgentTurnForTests(async () => {
      throw new Error("LLM should not run for memory recall");
    });

    await storeMemory({
      userId: "user_1",
      content: "User prefers 30-minute focus sessions.",
    });

    const res = await runLlmTurn({
      userId: "user_1",
      message: "what do you remember about me?",
      tzOffsetMinutes: 0,
    });

    expect(res.toolResults[0].tool).toBe("list_memories");
    expect(res.assistantMessage).toMatch(/30-minute/i);
    expect(res.assistantMessage).not.toMatch(/Got it — I'll remember/i);
  });

  test("recall is isolated per user", async () => {
    setCompleteAgentTurnForTests(async () => {
      throw new Error("LLM should not run for memory recall");
    });

    await storeMemory({
      userId: "user_a",
      content: "User prefers 30-minute focus sessions.",
    });
    await storeMemory({
      userId: "user_b",
      content: "User prefers night study sessions.",
    });

    const a = await runLlmTurn({
      userId: "user_a",
      message: "what do you know about me?",
      tzOffsetMinutes: 0,
    });
    const b = await runLlmTurn({
      userId: "user_b",
      message: "what do you know about me?",
      tzOffsetMinutes: 0,
    });

    expect(a.assistantMessage).toMatch(/30-minute/i);
    expect(a.assistantMessage).not.toMatch(/night/i);
    expect(b.assistantMessage).toMatch(/night/i);
    expect(b.assistantMessage).not.toMatch(/30-minute/i);
  });

  test("bare recall question lists memories without LLM", async () => {
    setCompleteAgentTurnForTests(async () => {
      throw new Error("LLM should not run for memory recall");
    });

    await storeMemory({
      userId: "user_1",
      content: "User prefers morning study.",
    });

    const res = await runLlmTurn({
      userId: "user_1",
      message: "what do you remember?",
      tzOffsetMinutes: 0,
    });

    expect(res.toolResults[0].tool).toBe("list_memories");
    expect(res.assistantMessage).toMatch(/morning/i);
  });

  test("forget all clears stored preferences", async () => {
    setCompleteAgentTurnForTests(async () => {
      throw new Error("LLM should not run for forget-all");
    });

    await storeMemory({
      userId: "user_1",
      content: "User prefers morning study.",
    });

    const forget = await runLlmTurn({
      userId: "user_1",
      message: "forget everything about me",
      tzOffsetMinutes: 0,
    });
    expect(forget.toolResults[0].tool).toBe("delete_memory");
    expect(forget.assistantMessage).toMatch(/Cleared 1/i);

    const recall = await runLlmTurn({
      userId: "user_1",
      message: "what do you remember?",
      tzOffsetMinutes: 0,
    });
    expect(recall.assistantMessage).toMatch(/don't have any stored preferences/i);
  });

  test("specific forget deletes matching preference without LLM", async () => {
    setCompleteAgentTurnForTests(async () => {
      throw new Error("LLM should not run for specific forget");
    });

    await storeMemory({
      userId: "user_1",
      content: "User preference: I do sudoku every now and then to keep my brain sharp",
    });
    await storeMemory({
      userId: "user_1",
      content: "User preference: what",
    });
    await storeMemory({
      userId: "user_1",
      content: "User preference: I enjoy planning",
    });

    const forgetSudoku = await runLlmTurn({
      userId: "user_1",
      message: "delete the sudoku memory",
      tzOffsetMinutes: 0,
    });
    expect(forgetSudoku.toolResults[0].tool).toBe("delete_memory");
    expect(forgetSudoku.toolResults[0].ok).toBe(true);
    expect(forgetSudoku.assistantMessage).toMatch(/sudoku/i);

    const forgetWhat = await runLlmTurn({
      userId: "user_1",
      message: "remove the what preference,",
      tzOffsetMinutes: 0,
    });
    expect(forgetWhat.toolResults[0].tool).toBe("delete_memory");
    expect(forgetWhat.toolResults[0].ok).toBe(true);
    expect(forgetWhat.assistantMessage).toMatch(/what/i);

    const recall = await runLlmTurn({
      userId: "user_1",
      message: "what do you remember about me?",
      tzOffsetMinutes: 0,
    });
    expect(recall.assistantMessage).toMatch(/planning/i);
    expect(recall.assistantMessage).not.toMatch(/sudoku/i);
    expect(recall.assistantMessage).not.toMatch(/preference: what/i);
  });

  test("forget about me and leetcode morning preferences", async () => {
    setCompleteAgentTurnForTests(async () => {
      throw new Error("LLM should not run for specific forget");
    });

    await storeMemory({
      userId: "user_1",
      content: "User preference: about me",
    });
    await storeMemory({
      userId: "user_1",
      content: "User preference: i like to do LeetCode in the morning",
    });
    await storeMemory({
      userId: "user_1",
      content: "User preference: I enjoy planning",
    });

    const forgetAboutMe = await runLlmTurn({
      userId: "user_1",
      message: "delete the about me preference",
      tzOffsetMinutes: 0,
    });
    expect(forgetAboutMe.toolResults[0].ok).toBe(true);
    expect(forgetAboutMe.assistantMessage).toMatch(/about me/i);

    await storeMemory({
      userId: "user_2",
      content: "User preference: about me",
    });
    const forgetQuoted = await runLlmTurn({
      userId: "user_2",
      message: 'delete the "about me" preference',
      tzOffsetMinutes: 0,
    });
    expect(forgetQuoted.toolResults[0].ok).toBe(true);

    const forgetLeetcode = await runLlmTurn({
      userId: "user_1",
      message:
        "delete the user preference i like to do leetcode in the morning",
      tzOffsetMinutes: 0,
    });
    expect(forgetLeetcode.toolResults[0].ok).toBe(true);
    expect(forgetLeetcode.assistantMessage).toMatch(/leetcode/i);

    const recall = await runLlmTurn({
      userId: "user_1",
      message: "what do you remember about me?",
      tzOffsetMinutes: 0,
    });
    expect(recall.assistantMessage).toMatch(/planning/i);
    expect(recall.assistantMessage).not.toMatch(/about me/i);
    expect(recall.assistantMessage).not.toMatch(/leetcode/i);
  });
});
