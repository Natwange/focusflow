const express = require("express");
const { z } = require("zod");
const { executeTool } = require("../agent/toolExecutor");
const { parseRuleBasedMessage, INTENTS } = require("../agent/ruleParser");
const { validateBody } = require("../middleware/validateBody");
const { prismaErrorMessage } = require("../lib/prismaErrors");

const router = express.Router();

const agentChatBodySchema = z.object({
  message: z.string().trim().min(1, "message is required").max(2000),
  tzOffsetMinutes: z.coerce.number().int().min(-840).max(840).optional(),
});

function parseTzFromBody(body) {
  if (body.tzOffsetMinutes === undefined) return 0;
  return body.tzOffsetMinutes;
}

function collectClientActions(toolResults) {
  const actions = [];
  for (const tr of toolResults) {
    if (tr.tool !== "suggest_focus_session" || !tr.ok) continue;
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
    return "You have no tasks due today (including overdue).";
  }
  const lines = tasks.slice(0, 15).map((t) => {
    const due = t.dueDate ? new Date(t.dueDate).toISOString() : "no due date";
    return `• ${t.title} (${t.status}, due ${due})`;
  });
  const more = tasks.length > 15 ? `\n…and ${tasks.length - 15} more.` : "";
  return `Here are your tasks for today:\n${lines.join("\n")}${more}`;
}

function buildAssistantMessage(intent, toolResults, plan) {
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
 * POST /agent/chat — rule-based command router (Phase 2, no LLM).
 */
router.post("/chat", validateBody(agentChatBodySchema), async (req, res) => {
  try {
    const userId = req.user.id;
    const { message } = req.body;
    const tzOffsetMinutes = parseTzFromBody(req.body);

    const plan = parseRuleBasedMessage(message, tzOffsetMinutes);

    if (plan.type === "clarify" || plan.type === "unsupported") {
      return res.json({
        assistantMessage: plan.assistantMessage,
        intent: plan.intent,
        toolResults: [],
        pendingConfirmation: null,
        clientActions: [],
      });
    }

    const ctx = { userId, tzOffsetMinutes };
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

    const clientActions = collectClientActions(toolResults);
    const assistantMessage = buildAssistantMessage(
      plan.intent,
      toolResults,
      plan
    );

    return res.json({
      assistantMessage,
      intent: plan.intent,
      toolResults,
      pendingConfirmation: null,
      clientActions,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: prismaErrorMessage(err) });
  }
});

module.exports = router;
