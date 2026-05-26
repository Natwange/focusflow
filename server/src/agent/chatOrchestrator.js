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
} = require("./ruleParser");
const { isV1ToolName, parseToolArgs } = require("./tools");

/**
 * @typedef {object} ChatRunInput
 * @property {string} userId
 * @property {string} message
 * @property {number} [tzOffsetMinutes]
 */

/**
 * @typedef {object} AgentChatResponse
 * @property {string} assistantMessage
 * @property {Array<object>} toolResults
 * @property {null} pendingConfirmation
 * @property {Array<object>} clientActions
 */

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
    return {
      assistantMessage: plan.assistantMessage,
      toolResults: [],
      pendingConfirmation: null,
      clientActions: [],
    };
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

  return {
    assistantMessage: buildRuleBasedAssistantMessage(
      plan.intent,
      toolResults,
      plan
    ),
    toolResults,
    pendingConfirmation: null,
    clientActions: collectClientActions(toolResults),
  };
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
  const last = toolResults[toolResults.length - 1];
  if (!last) return "I could not complete that request.";
  if (!last.ok) {
    return last.result?.summary ?? last.result?.error ?? "Something went wrong.";
  }
  return last.result.summary;
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
  const entry = toolResults[0];
  if (!entry?.result) return fallback;

  try {
    const observed = await completeObserveRespond({
      message,
      tzOffsetMinutes,
      toolName,
      args,
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

/**
 * @param {ChatRunInput} input
 * @returns {Promise<AgentChatResponse>}
 */
async function runLlmTurn({ userId, message, tzOffsetMinutes = 0 }) {
  const ctx = { userId, tzOffsetMinutes };
  const llmResult = await completeAgentTurn({ message, tzOffsetMinutes });

  if (llmResult.type === "message") {
    const text =
      llmResult.content ||
      "How can I help with your tasks, focus session, or goal plan?";
    return {
      assistantMessage: text,
      toolResults: [],
      pendingConfirmation: null,
      clientActions: [],
    };
  }

  const toolName = llmResult.toolName;
  if (!isV1ToolName(toolName)) {
    return {
      assistantMessage:
        "I can only help with listing or creating tasks, focus summary, starting focus, or previewing a goal plan.",
      toolResults: [],
      pendingConfirmation: null,
      clientActions: [],
    };
  }

  const parsed = parseToolArgs(toolName, llmResult.rawArgs);
  if (!parsed.ok) {
    return {
      assistantMessage: clarificationMessage(parsed.error),
      toolResults: [],
      pendingConfirmation: null,
      clientActions: [],
    };
  }

  let toolArgs = parsed.args;
  if (toolName === "list_tasks") {
    toolArgs = listTasksArgsForTodayIntent(
      message,
      tzOffsetMinutes,
      parsed.args
    );
  }

  const result = await executeTool(ctx, toolName, toolArgs);
  const toolResults = [
    {
      tool: toolName,
      args: toolArgs,
      ok: result.ok,
      result,
    },
  ];

  const assistantMessage = await assistantMessageAfterToolExecution({
    message,
    tzOffsetMinutes,
    toolName,
    args: toolArgs,
    toolResults,
  });

  return {
    assistantMessage,
    toolResults,
    pendingConfirmation: null,
    clientActions: collectClientActions(toolResults),
  };
}

/**
 * @param {ChatRunInput} input
 * @returns {Promise<AgentChatResponse>}
 */
async function run({ userId, message, tzOffsetMinutes = 0 }) {
  if (!isLlmConfigured()) {
    return runRuleBasedFallback({ userId, message, tzOffsetMinutes });
  }

  try {
    return await runLlmTurn({ userId, message, tzOffsetMinutes });
  } catch (err) {
    console.error("Agent LLM turn failed, using rule-based fallback:", err);
    return runRuleBasedFallback({ userId, message, tzOffsetMinutes });
  }
}

module.exports = {
  run,
  runRuleBasedFallback,
  runLlmTurn,
  collectClientActions,
  formatListTasksReply,
  toolSummaryFallback,
  assistantMessageAfterToolExecution,
};
