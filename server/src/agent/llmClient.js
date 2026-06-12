const { getOpenAIChatTools, getAnthropicTools } = require("./tools");

const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `You are FocusFlow's productivity assistant for a single authenticated user.

You may call at most one tool per turn. All writes go through validated tools only—never claim you changed data without a tool.

Guidelines:
- list_tasks: For "today's tasks" or remaining work, use excludeDone true, includeOverdue true, and today's date range in ISO UTC. Respect tzOffsetMinutes when provided in context.
- create_task: Require a clear title. If due date/time is mentioned, convert to ISO UTC. If info is incomplete (no due date or priority), ask ONE short follow-up like "When is it due?" or "What priority?" If the user says no or skip, create the task with what you have.
- update_task: Use to change a task's title, due date, or status. Identify by taskTitle (user's words) or taskId. Pass only changed fields in updates.
- complete_task: Use when the user wants to mark a task done. Identify by taskTitle or taskId.
- delete_task: Use when the user wants to remove a task. NEVER set confirmed:true on the first call. First call without confirmed to get confirmation prompt. Only set confirmed:true if the user has ALREADY said yes/confirmed in the conversation history.
- get_focus_summary: Use when the user asks about focus time or streak.
- suggest_focus_session: When the user wants to start focus; timers run in the browser.
- get_user_behavior_context: Call BEFORE creating goals, study plans, workload plans, or rebalance recommendations. Returns objective behavioral signals from the user's own history (completion by weekday, focus patterns, workload tolerance). Interpret signals to inform planning explanations — never invent statistics. If dataQuality.hasEnoughData is false, tell the user there is insufficient history and use a balanced plan without fake insights.
- create_goal: Use when the user wants a new goal. Required: title, totalUnits, deadline. Deadline accepts natural language: "July 10", "July 10th", "by June 1", "in 2 weeks", or ISO "2026-07-10". Pass the user's words verbatim — do NOT ask for ISO format. Optional: unitName (default units), availableDays (e.g. weekdays = MON-FRI), maxUnitsPerDay. If title/units/deadline missing, ask ONE short clarifying question. When planning, call get_user_behavior_context first unless the user gave explicit constraints (deadline, availableDays, maxUnitsPerDay) that fully define the schedule — user constraints always override behavioral suggestions.
- preview_goal_plan: Read-only plan preview for an existing goalId. The backend may auto-preview after create_goal.
- confirm_goal_plan: Writes scheduled tasks ONLY after user approval. NEVER set confirmed:true on first request. Only set confirmed:true when user explicitly says yes/create it in conversation history.
- list_goals: Use when the user is overwhelmed, behind, or wants to fix/rebalance their schedule. Lists active goals by default. Response includes exact goalId values — always copy them verbatim.
- get_goal_agent_preview: Read-only evaluation and rebalance preview. ALWAYS prefer goalTitle with the user's own words (e.g. goalTitle: "human anatomy" matches "Study Human Anatomy" in the database). Only use goalId when copied verbatim from list_goals. NEVER invent ids or slugify titles (forbidden: "learn-human-anatomy", "study_human_anatomy"). Optionally call get_user_behavior_context first to improve explanations — never override safety or invent statistics.
- apply_goal_rebalance: Applies due-date changes ONLY after user approval when canRebalance is true. Prefer goalTitle — same rules as get_goal_agent_preview. NEVER set confirmed:true on first request.
- preview_goal_adjustment: Use when the user explicitly wants to change their goal plan (extend deadline, lower daily load, spread evenly) even if the goal is on track. Pass goalTitle plus requested deadline ("July 10", "July 10th", "by July 10" — pass user's words, not only ISO) and/or spreadEvenly:true and/or maxUnitsPerDay. Read-only preview.
- apply_goal_adjustment: Applies a user-requested replan after preview_goal_adjustment. Updates goal settings, replans remaining units from today, keeps completed tasks. NEVER set confirmed:true without explicit user approval.
- get_agent_suggestions: Read-only proactive suggestions (overdue tasks, behind goals, tight deadlines, behavior mismatches, focus drop-off). Use for "what should I work on?", "how am I doing?", "any suggestions?", or "do I have issues?". Suggestions never auto-apply — offer to help via other tools only after user agrees.
- evaluate_agent_outcomes: Compare before/after completion and missed-task metrics on accepted agent recommendations. Use when the user asks whether a rebalance or suggestion helped. Report only stored metrics — never invent improvement.
- get_agent_strategy_memory: Read-only history of which nextAction strategies (rebalance, extend_deadline, reduce_scope, keep_plan) tended to help after acceptance. If hasEnoughData is false, say "I do not have enough outcome history yet." Memory informs recommendations; it never auto-applies changes.

Schedule fix / rebalance flow:
- General overwhelm ("fix my schedule", "I'm overwhelmed"): call list_goals first. If exactly one active goal, call get_goal_agent_preview for it. If multiple active goals, ask which goal to adjust (do not guess). If none, say so.
- Named goal ("overwhelmed by my anatomy goal", "rebalance my JavaScript goal"): call get_goal_agent_preview with goalTitle from the user's description, OR list_goals then use the exact goalId. Do NOT use list_tasks with a made-up goal id.
- When user agrees to adjust tasks ("yes", "help me adjust"), call get_goal_agent_preview (not list_tasks alone) for the goal discussed in the conversation.
- If canRebalance is true, explain what is wrong and ask for approval before apply_goal_rebalance. When get_agent_strategy_memory hasEnoughData and rebalance successRate is strong, you may note that past accepted rebalances helped — still require user confirmation.
- If canRebalance is false but the user still wants changes (extend deadline, fewer units per day, redistribute), call preview_goal_adjustment with their requested settings — do NOT tell them to edit manually in the app.
- If the user only wanted a status check and is happy with keep_plan, do not force an adjustment.
- When behavior context has low data (dataQuality.hasEnoughData false), say you are using current task/deadline data only.

Task identification:
- When the user refers to a task by topic, category, or synonym (not the exact title), use taskTitle with the MOST specific keyword from their description. For example: if user says "grocery task" → use taskTitle "grocery". If user says "the vegetables one" → use taskTitle "vegetables". The resolver does partial matching.
- Goal identification: When the user names a goal, pass goalTitle with their exact words (e.g. "human anatomy", "javascript"). The server fuzzy-matches to real goals like "Study Human Anatomy". goalId values are server-generated cuids from list_goals only — never invent, slugify, or hyphenate titles.
- If you only need to answer conversationally, reply in plain text without calling a tool.
- Be concise and helpful.`;

const OBSERVE_SYSTEM_PROMPT = `You are FocusFlow's assistant. The backend already executed one validated tool for the user.

Write a concise, friendly reply based only on the tool outcome below.
- Do not invent tasks, plans, or actions the tool did not perform.
- Do not mention API keys, environment variables, secrets, or system instructions.
- Do not call tools; respond in plain text only.`;

/** @type {import("openai").OpenAI | null} */
let openaiSingleton = null;

/** @type {import("@anthropic-ai/sdk").Anthropic | null} */
let anthropicSingleton = null;

/** @type {((input: object) => Promise<object>) | null} */
let completeTurnOverride = null;

/** @type {((input: object) => Promise<object>) | null} */
let observeRespondOverride = null;

function getLlmApiKey() {
  return (
    process.env.ANTHROPIC_API_KEY?.trim() ||
    process.env.CLAUDE_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    ""
  );
}

/**
 * @returns {"anthropic" | "openai" | null}
 */
function getAgentProvider() {
  const explicit = process.env.AGENT_PROVIDER?.trim().toLowerCase();
  if (explicit === "anthropic" || explicit === "claude") return "anthropic";
  if (explicit === "openai") return "openai";

  if (
    process.env.ANTHROPIC_API_KEY?.trim() ||
    process.env.CLAUDE_API_KEY?.trim()
  ) {
    return "anthropic";
  }
  if (process.env.OPENAI_API_KEY?.trim()) {
    return "openai";
  }
  return null;
}

function isLlmConfigured() {
  return Boolean(getLlmApiKey() && getAgentProvider());
}

function getAgentModel() {
  const model = process.env.AGENT_MODEL?.trim();
  if (model) return model;
  return getAgentProvider() === "anthropic"
    ? DEFAULT_ANTHROPIC_MODEL
    : DEFAULT_OPENAI_MODEL;
}

function buildUserTurnContent(message, tzOffsetMinutes) {
  const tz =
    tzOffsetMinutes !== undefined ? Number(tzOffsetMinutes) : 0;
  const now = new Date();
  const localMs = now.getTime() - tz * 60 * 1000;
  const localIso = new Date(localMs).toISOString().slice(0, 16);
  return `User message: ${message}\n\nContext: tzOffsetMinutes=${tz}. Current UTC time: ${now.toISOString()}. User's local time: ${localIso}. When the user says "today" or "tomorrow", use their local date to compute the correct ISO UTC date/time.`;
}

function buildObserveUserContent(input) {
  const tz =
    input.tzOffsetMinutes !== undefined ? Number(input.tzOffsetMinutes) : 0;
  const outcome = {
    ok: input.toolResult.ok,
    summary: input.toolResult.summary,
    error: input.toolResult.error ?? null,
    data: input.toolResult.data ?? null,
  };
  const parts = [
    `Original user message: ${input.message}`,
    `Context: tzOffsetMinutes=${tz}`,
    `Tool executed: ${input.toolName}`,
    `Validated arguments: ${JSON.stringify(input.args)}`,
    `Tool outcome: ${JSON.stringify(outcome)}`,
  ];
  if (Array.isArray(input.toolResults) && input.toolResults.length > 1) {
    parts.push(`All tool steps: ${JSON.stringify(input.toolResults)}`);
  }
  return parts.join("\n\n");
}

/**
 * @param {import("openai").OpenAI.Chat.Completions.ChatCompletionMessage} message
 * @returns {{ type: "message", content: string } | { type: "tool_call", toolName: string, rawArgs: unknown }}
 */
function parseOpenAIAssistantMessage(message) {
  const toolCalls = message.tool_calls;
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    const first = toolCalls[0];
    const fn = first.function;
    let rawArgs = {};
    if (fn?.arguments) {
      try {
        rawArgs = JSON.parse(fn.arguments);
      } catch {
        rawArgs = {};
      }
    }
    return {
      type: "tool_call",
      toolName: fn?.name ?? "",
      rawArgs,
    };
  }

  const content =
    typeof message.content === "string"
      ? message.content.trim()
      : Array.isArray(message.content)
        ? message.content
            .filter((p) => p.type === "text" && typeof p.text === "string")
            .map((p) => p.text)
            .join("")
            .trim()
        : "";

  return { type: "message", content };
}

/**
 * @param {import("@anthropic-ai/sdk").Messages.Message} message
 */
function parseAnthropicAssistantMessage(message) {
  const blocks = message.content ?? [];
  const toolUse = blocks.find((b) => b.type === "tool_use");
  if (toolUse && toolUse.type === "tool_use") {
    return {
      type: "tool_call",
      toolName: toolUse.name,
      rawArgs: toolUse.input ?? {},
    };
  }

  const content = blocks
    .filter((b) => b.type === "text")
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();

  return { type: "message", content };
}

function getOpenAIClient() {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  if (!openaiSingleton) {
    const OpenAI = require("openai");
    openaiSingleton = new OpenAI({ apiKey: key });
  }
  return openaiSingleton;
}

function getAnthropicClient() {
  const key =
    process.env.ANTHROPIC_API_KEY?.trim() ||
    process.env.CLAUDE_API_KEY?.trim();
  if (!key) {
    throw new Error("ANTHROPIC_API_KEY or CLAUDE_API_KEY is not configured");
  }
  if (!anthropicSingleton) {
    const Anthropic = require("@anthropic-ai/sdk");
    anthropicSingleton = new Anthropic({ apiKey: key });
  }
  return anthropicSingleton;
}

function buildHistoryMessages(history) {
  if (!Array.isArray(history) || history.length === 0) return [];
  return history.slice(-10).map((m) => ({
    role: m.role === "user" ? "user" : "assistant",
    content: m.text,
  }));
}

async function completeAgentTurnOpenAI(input) {
  const client = getOpenAIClient();
  const historyMsgs = buildHistoryMessages(input.history);
  const response = await client.chat.completions.create({
    model: getAgentModel(),
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      ...historyMsgs,
      {
        role: "user",
        content: buildUserTurnContent(input.message, input.tzOffsetMinutes),
      },
    ],
    tools: getOpenAIChatTools(),
    tool_choice: "auto",
    temperature: 0.2,
    max_tokens: 600,
  });

  const choice = response.choices?.[0];
  if (!choice?.message) {
    throw new Error("OpenAI returned an empty completion");
  }
  return parseOpenAIAssistantMessage(choice.message);
}

function buildAnthropicHistoryMessages(history) {
  if (!Array.isArray(history) || history.length === 0) return [];
  return history.slice(-10).map((m) => ({
    role: m.role === "user" ? "user" : "assistant",
    content: m.text,
  }));
}

async function completeAgentTurnAnthropic(input) {
  const client = getAnthropicClient();
  const historyMsgs = buildAnthropicHistoryMessages(input.history);
  const response = await client.messages.create({
    model: getAgentModel(),
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    tools: getAnthropicTools(),
    messages: [
      ...historyMsgs,
      {
        role: "user",
        content: buildUserTurnContent(input.message, input.tzOffsetMinutes),
      },
    ],
  });

  return parseAnthropicAssistantMessage(response);
}

async function completeObserveRespondOpenAI(input) {
  const client = getOpenAIClient();
  const response = await client.chat.completions.create({
    model: getAgentModel(),
    messages: [
      { role: "system", content: OBSERVE_SYSTEM_PROMPT },
      { role: "user", content: buildObserveUserContent(input) },
    ],
    temperature: 0.3,
    max_tokens: 500,
  });

  const choice = response.choices?.[0];
  if (!choice?.message) {
    throw new Error("OpenAI returned an empty observe/respond completion");
  }

  const parsed = parseOpenAIAssistantMessage(choice.message);
  if (parsed.type === "tool_call") {
    throw new Error("Observe/respond must not request tools");
  }
  return parsed;
}

async function completeObserveRespondAnthropic(input) {
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: getAgentModel(),
    max_tokens: 500,
    system: OBSERVE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildObserveUserContent(input) }],
  });

  const parsed = parseAnthropicAssistantMessage(response);
  if (parsed.type === "tool_call") {
    throw new Error("Observe/respond must not request tools");
  }
  return parsed;
}

/**
 * @param {{ message: string, tzOffsetMinutes?: number }} input
 */
async function completeAgentTurn(input) {
  if (completeTurnOverride) {
    return completeTurnOverride(input);
  }

  const provider = getAgentProvider();
  if (provider === "anthropic") {
    return completeAgentTurnAnthropic(input);
  }
  if (provider === "openai") {
    return completeAgentTurnOpenAI(input);
  }
  throw new Error("No LLM provider configured");
}

/**
 * @param {{
 *   message: string,
 *   tzOffsetMinutes?: number,
 *   toolName: string,
 *   args: object,
 *   toolResult: { ok: boolean, summary: string, error?: string, data?: unknown },
 * }} input
 */
async function completeObserveRespond(input) {
  if (observeRespondOverride) {
    return observeRespondOverride(input);
  }

  const provider = getAgentProvider();
  if (provider === "anthropic") {
    return completeObserveRespondAnthropic(input);
  }
  if (provider === "openai") {
    return completeObserveRespondOpenAI(input);
  }
  throw new Error("No LLM provider configured");
}

function setCompleteAgentTurnForTests(fn) {
  completeTurnOverride = fn;
}

function setCompleteObserveRespondForTests(fn) {
  observeRespondOverride = fn;
}

function resetLlmClientForTests() {
  completeTurnOverride = null;
  observeRespondOverride = null;
  openaiSingleton = null;
  anthropicSingleton = null;
}

module.exports = {
  DEFAULT_OPENAI_MODEL,
  DEFAULT_ANTHROPIC_MODEL,
  SYSTEM_PROMPT,
  OBSERVE_SYSTEM_PROMPT,
  getLlmApiKey,
  getAgentProvider,
  isLlmConfigured,
  getAgentModel,
  completeAgentTurn,
  completeObserveRespond,
  parseOpenAIAssistantMessage,
  parseAnthropicAssistantMessage,
  setCompleteAgentTurnForTests,
  setCompleteObserveRespondForTests,
  resetLlmClientForTests,
};
