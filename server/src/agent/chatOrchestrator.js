const { executeTool } = require("./toolExecutor");
const {
  isLlmConfigured,
  completeAgentTurn,
  completeObserveRespond,
} = require("./llmClient");
const {
  parseRuleBasedMessage,
  INTENTS,
  listTasksArgsForTodayIntent,
  isCreateTaskRetryMessage,
  findLastUserCreateTaskArgs,
} = require("./ruleParser");
const { isV1ToolName, parseToolArgs } = require("./tools");
const {
  isAffirmativeConfirmation,
  pendingConfirmationToToolCall,
} = require("./pendingConfirmationResolver");
const { maybeAutoExtractAndStore, storeMemory, listMemories, isMem0Configured, formatMemoryListSummary } = require("../memory/mem0Service");
const {
  extractExplicitRememberContent,
  isExplicitRememberRequest,
  isMemoryRecallRequest,
} = require("../memory/memoryExtraction");
function getOrchestratorMode() {
  const mode = String(process.env.AGENT_ORCHESTRATOR || "custom").toLowerCase();
  return mode === "langgraph" ? "langgraph" : "custom";
}

/**
 * @typedef {object} ChatRunInput
 * @property {string} userId
 * @property {string} message
 * @property {number} [tzOffsetMinutes]
 * @property {Array<{role: string, text: string}>} [history]
 * @property {object | null} [pendingConfirmation]
 */

/**
 * @typedef {object} AgentChatResponse
 * @property {string} assistantMessage
 * @property {Array<object>} toolResults
 * @property {null} pendingConfirmation
 * @property {Array<object>} clientActions
 * @property {string[]} mutations
 */

const WRITE_TOOLS_USE_TOOL_SUMMARY = new Set([
  "create_task",
  "update_task",
  "complete_task",
  "delete_task",
  "confirm_goal_plan",
  "apply_goal_rebalance",
  "apply_goal_adjustment",
  "store_memory",
  "delete_memory",
  "retrieve_memory",
  "list_memories",
]);

function collectMutationTypes(toolResults) {
  const types = [];
  for (const tr of toolResults) {
    if (!tr.ok) continue;
    if (tr.tool === "create_task") types.push("task_created");
    if (tr.tool === "update_task") types.push("task_updated");
    if (tr.tool === "complete_task") types.push("task_completed");
    if (tr.tool === "delete_task" && tr.result?.data?.deletedTaskId) {
      types.push("task_deleted");
    }
    if (tr.tool === "create_goal") types.push("goal_created");
    if (tr.tool === "confirm_goal_plan" && tr.result?.data?.createdCount) {
      types.push("goal_plan_confirmed");
      types.push("task_created");
    }
    if (tr.tool === "apply_goal_rebalance" && tr.result?.data?.applied) {
      types.push("goal_rebalanced");
      types.push("task_updated");
    }
    if (tr.tool === "apply_goal_adjustment" && tr.result?.data?.applied) {
      types.push("goal_rebalanced");
      types.push("task_updated");
    }
  }
  return [...new Set(types)];
}

function withMutations(response) {
  return {
    ...response,
    mutations: collectMutationTypes(response.toolResults ?? []),
  };
}

function collectClientActions(toolResults) {
  const actions = [];
  for (const tr of toolResults) {
    if (!tr.ok) continue;
    const action = tr.result?.data?.clientAction;
    if (action && typeof action === "object") {
      actions.push(action);
    }
  }
  return actions;
}

function formatListTasksReply(toolResults) {
  const tr = toolResults.find((r) => r.tool === "list_tasks");
  if (!tr?.ok) return tr?.result?.summary ?? "Could not load tasks.";
  const tasks = tr.result?.data?.tasks ?? [];
  if (tasks.length === 0) {
    return "You have no incomplete tasks due today (including overdue).";
  }
  const lines = tasks.slice(0, 15).map((t) => {
    const due = t.dueDate ? new Date(t.dueDate).toISOString() : "no due date";
    return `• ${t.title} (${t.status}, due ${due})`;
  });
  const more = tasks.length > 15 ? `\n…and ${tasks.length - 15} more.` : "";
  return `Here are your tasks for today:\n${lines.join("\n")}${more}`;
}

function buildRuleBasedAssistantMessage(intent, toolResults, plan) {
  if (plan.type === "clarify" || plan.type === "unsupported") {
    return plan.assistantMessage;
  }

  if (intent === INTENTS.LIST_TODAY_TASKS) {
    return formatListTasksReply(toolResults);
  }

  const last = toolResults[toolResults.length - 1];
  if (!last) {
    return "I could not complete that request.";
  }
  if (!last.ok) {
    return last.result?.summary ?? last.result?.error ?? "Something went wrong.";
  }
  return last.result.summary;
}

/**
 * @param {ChatRunInput} input
 * @returns {Promise<AgentChatResponse>}
 */
async function runRuleBasedFallback({ userId, message, tzOffsetMinutes = 0 }) {
  const plan = parseRuleBasedMessage(message, tzOffsetMinutes);
  const ctx = { userId, tzOffsetMinutes };

  if (plan.type === "clarify" || plan.type === "unsupported") {
    return withMutations({
      assistantMessage: plan.assistantMessage,
      toolResults: [],
      pendingConfirmation: null,
      clientActions: [],
    });
  }

  const toolResults = [];
  for (const call of plan.toolCalls ?? []) {
    const result = await executeTool(ctx, call.tool, call.args);
    toolResults.push({
      tool: call.tool,
      args: call.args,
      ok: result.ok,
      result,
    });
  }

  return withMutations({
    assistantMessage: buildRuleBasedAssistantMessage(
      plan.intent,
      toolResults,
      plan
    ),
    toolResults,
    pendingConfirmation: null,
    clientActions: collectClientActions(toolResults),
  });
}

function clarificationMessage(detail) {
  if (/title/i.test(detail)) {
    return "What should the task be called?";
  }
  if (/dueDate|due date|date/i.test(detail)) {
    return "When is this task due? Please include a date and time (for example, tomorrow at 11am).";
  }
  return `I need a bit more detail: ${detail}`;
}

function toolSummaryFallback(toolName, toolResults) {
  if (toolName === "list_tasks") {
    return formatListTasksReply(toolResults);
  }
  if (toolResults.length > 1) {
    const lines = toolResults
      .map((tr) => {
        if (!tr.ok) return tr.result?.summary ?? tr.result?.error ?? "Step failed.";
        return tr.result?.summary;
      })
      .filter(Boolean);
    if (lines.length > 0) return lines.join("\n");
  }
  const last = toolResults[toolResults.length - 1];
  if (!last) return "I could not complete that request.";
  if (!last.ok) {
    return last.result?.summary ?? last.result?.error ?? "Something went wrong.";
  }
  return last.result.summary;
}

/**
 * Run up to 2 tools in one turn (create_goal auto-chains preview_goal_plan).
 */
async function executeToolChain(ctx, toolName, toolArgs) {
  const toolResults = [];
  const first = await executeTool(ctx, toolName, toolArgs);
  toolResults.push({
    tool: toolName,
    args: toolArgs,
    ok: first.ok,
    result: first,
  });

  if (
    toolName === "create_goal" &&
    first.ok &&
    first.data?.goal?.id &&
    toolResults.length < 2
  ) {
    const previewArgs = { goalId: first.data.goal.id };
    const preview = await executeTool(ctx, "preview_goal_plan", previewArgs);
    toolResults.push({
      tool: "preview_goal_plan",
      args: previewArgs,
      ok: preview.ok,
      result: preview,
    });
  }

  return toolResults;
}

function extractPendingConfirmation(toolResults) {
  for (let i = toolResults.length - 1; i >= 0; i -= 1) {
    const tr = toolResults[i];
    if (!tr?.ok) continue;
    const pending = tr.result?.data?.pendingConfirmation;
    if (pending && typeof pending === "object") {
      return pending;
    }
  }
  return null;
}

/**
 * @param {{
 *   message: string,
 *   tzOffsetMinutes: number,
 *   toolName: string,
 *   args: object,
 *   toolResults: Array<object>,
 * }} input
 */
async function assistantMessageAfterToolExecution(input) {
  const { message, tzOffsetMinutes, toolName, args, toolResults } = input;
  const fallback = toolSummaryFallback(toolName, toolResults);
  const entry = toolResults[toolResults.length - 1] ?? toolResults[0];
  if (!entry?.result) return fallback;

  const resolvedTool = entry.tool ?? toolName;
  if (
    entry.ok &&
    entry.result.summary &&
    WRITE_TOOLS_USE_TOOL_SUMMARY.has(resolvedTool)
  ) {
    return entry.result.summary;
  }

  try {
    const observed = await completeObserveRespond({
      message,
      tzOffsetMinutes,
      toolName: entry.tool ?? toolName,
      args: entry.args ?? args,
      toolResults: toolResults.map((tr) => ({
        tool: tr.tool,
        ok: tr.ok,
        summary: tr.result?.summary,
        error: tr.result?.error,
      })),
      toolResult: {
        ok: entry.result.ok,
        summary: entry.result.summary,
        error: entry.result.error,
        data: entry.result.data ?? null,
      },
    });
    if (observed.type === "message" && observed.content) {
      return observed.content;
    }
  } catch (err) {
    console.error("Agent observe/respond failed, using tool summary:", err);
  }

  return fallback;
}

async function runCreateTaskRetryIfNeeded({
  userId,
  message,
  tzOffsetMinutes,
  history,
}) {
  if (!isCreateTaskRetryMessage(message)) return null;

  const toolArgs = findLastUserCreateTaskArgs(history, tzOffsetMinutes);
  if (!toolArgs) return null;

  const ctx = { userId, tzOffsetMinutes };
  const toolResults = await executeToolChain(ctx, "create_task", toolArgs);
  const responsePendingConfirmation = extractPendingConfirmation(toolResults);
  const assistantMessage = await assistantMessageAfterToolExecution({
    message,
    tzOffsetMinutes,
    toolName: "create_task",
    args: toolArgs,
    toolResults,
  });

  return withMutations({
    assistantMessage,
    toolResults,
    pendingConfirmation: responsePendingConfirmation,
    clientActions: collectClientActions(toolResults),
  });
}

async function runMemoryRecallIfNeeded({ userId, message }) {
  if (!isMemoryRecallRequest(message)) return null;

  if (!isMem0Configured()) {
    return withMutations({
      assistantMessage:
        "Long-term memory isn't enabled on the server yet — MEM0_API_KEY needs to be set in your API environment (e.g. Render → Environment). Once that's added, ask me again.",
      toolResults: [],
      pendingConfirmation: null,
      clientActions: [],
    });
  }

  const memories = await listMemories({ userId });
  const toolResults = [
    {
      tool: "list_memories",
      args: {},
      ok: true,
      result: {
        ok: true,
        summary: formatMemoryListSummary(memories),
        data: { memories },
      },
    },
  ];

  return withMutations({
    assistantMessage: formatMemoryListSummary(memories),
    toolResults,
    pendingConfirmation: null,
    clientActions: collectClientActions(toolResults),
  });
}

async function runExplicitRememberIfNeeded({ userId, message }) {
  if (!isExplicitRememberRequest(message)) return null;

  const content = extractExplicitRememberContent(message);
  if (!content) return null;

  if (!isMem0Configured()) {
    return withMutations({
      assistantMessage:
        "Long-term memory isn't enabled on the server yet — MEM0_API_KEY needs to be set in your API environment (e.g. Render → Environment). Once that's added, ask me again to remember this.",
      toolResults: [],
      pendingConfirmation: null,
      clientActions: [],
    });
  }

  const result = await storeMemory({
    userId,
    content,
    metadata: { source: "explicit_remember" },
  });

  const toolResults = [
    {
      tool: "store_memory",
      args: { content },
      ok: result.ok,
      result: result.ok
        ? {
            ok: true,
            summary: `Saved preference: "${result.memory.content}"`,
            data: { memory: result.memory },
          }
        : { ok: false, summary: result.error, error: result.error },
    },
  ];

  return withMutations({
    assistantMessage: result.ok
      ? `Got it — I'll remember: ${result.memory.content}`
      : result.error || "I couldn't save that preference.",
    toolResults,
    pendingConfirmation: null,
    clientActions: collectClientActions(toolResults),
  });
}

/**
 * @param {ChatRunInput} input
 * @returns {Promise<AgentChatResponse>}
 */
async function runLlmTurn({
  userId,
  message,
  tzOffsetMinutes = 0,
  history = [],
  pendingConfirmation = null,
}) {
  const ctx = { userId, tzOffsetMinutes };

  if (isAffirmativeConfirmation(message)) {
    const directCall = pendingConfirmationToToolCall(pendingConfirmation);
    if (directCall) {
      const result = await executeTool(
        ctx,
        directCall.toolName,
        directCall.toolArgs
      );
      const toolResults = [
        {
          tool: directCall.toolName,
          args: directCall.toolArgs,
          ok: result.ok,
          result,
        },
      ];
      const nextPending = extractPendingConfirmation(toolResults);
      const assistantMessage = await assistantMessageAfterToolExecution({
        message,
        tzOffsetMinutes,
        toolName: directCall.toolName,
        args: directCall.toolArgs,
        toolResults,
      });

      return withMutations({
        assistantMessage,
        toolResults,
        pendingConfirmation: nextPending,
        clientActions: collectClientActions(toolResults),
      });
    }
  }

  const recallResponse = await runMemoryRecallIfNeeded({ userId, message });
  if (recallResponse) return recallResponse;

  const rememberResponse = await runExplicitRememberIfNeeded({ userId, message });
  if (rememberResponse) return rememberResponse;

  const retryResponse = await runCreateTaskRetryIfNeeded({
    userId,
    message,
    tzOffsetMinutes,
    history,
  });
  if (retryResponse) return retryResponse;

  const llmResult = await completeAgentTurn({
    userId,
    message,
    tzOffsetMinutes,
    history,
  });

  if (llmResult.type === "message") {
    const text =
      llmResult.content ||
      "How can I help with your tasks, focus session, or goal plan?";
    return withMutations({
      assistantMessage: text,
      toolResults: [],
      pendingConfirmation: null,
      clientActions: [],
    });
  }

  const toolName = llmResult.toolName;
  if (!isV1ToolName(toolName)) {
    return withMutations({
      assistantMessage:
        "I can help with tasks, focus sessions, and goals — including creating goals, previewing plans, and confirming schedules.",
      toolResults: [],
      pendingConfirmation: null,
      clientActions: [],
    });
  }

  const parsed = parseToolArgs(toolName, llmResult.rawArgs);
  if (!parsed.ok) {
    return withMutations({
      assistantMessage: clarificationMessage(parsed.error),
      toolResults: [],
      pendingConfirmation: null,
      clientActions: [],
    });
  }

  let toolArgs = parsed.args;
  if (toolName === "list_tasks") {
    toolArgs = listTasksArgsForTodayIntent(
      message,
      tzOffsetMinutes,
      parsed.args
    );
  }

  const toolResults = await executeToolChain(ctx, toolName, toolArgs);
  const responsePendingConfirmation = extractPendingConfirmation(toolResults);

  const assistantMessage = await assistantMessageAfterToolExecution({
    message,
    tzOffsetMinutes,
    toolName,
    args: toolArgs,
    toolResults,
  });

  return withMutations({
    assistantMessage,
    toolResults,
    pendingConfirmation: responsePendingConfirmation,
    clientActions: collectClientActions(toolResults),
  });
}

/**
 * @param {ChatRunInput} input
 * @returns {Promise<AgentChatResponse>}
 */
async function run({
  userId,
  message,
  tzOffsetMinutes = 0,
  history = [],
  pendingConfirmation = null,
}) {
  let result;

  if (!isLlmConfigured()) {
    result = await runRuleBasedFallback({ userId, message, tzOffsetMinutes });
  } else {
    try {
      if (getOrchestratorMode() === "langgraph") {
        const { runLangGraphAgent } = require("./langGraphAgent");
        result = await runLangGraphAgent({
          userId,
          message,
          tzOffsetMinutes,
          history,
          pendingConfirmation,
        });
      } else {
        result = await runLlmTurn({
          userId,
          message,
          tzOffsetMinutes,
          history,
          pendingConfirmation,
        });
      }
    } catch (err) {
      console.error("Agent LLM turn failed, using rule-based fallback:", err);
      result = await runRuleBasedFallback({ userId, message, tzOffsetMinutes });
    }
  }

  try {
    await maybeAutoExtractAndStore({
      userId,
      userMessage: message,
      assistantMessage: result.assistantMessage,
      toolResults: result.toolResults ?? [],
    });
  } catch (err) {
    console.warn("Mem0 post-turn persistence failed:", err.message);
  }

  return result;
}

module.exports = {
  run,
  getOrchestratorMode,
  runRuleBasedFallback,
  runLlmTurn,
  collectClientActions,
  collectMutationTypes,
  formatListTasksReply,
  toolSummaryFallback,
  assistantMessageAfterToolExecution,
  executeToolChain,
  extractPendingConfirmation,
  isAffirmativeConfirmation,
  pendingConfirmationToToolCall,
  runCreateTaskRetryIfNeeded,
};
