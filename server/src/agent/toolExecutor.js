const { PlanInputError } = require("../lib/buildPlan");
const { getFocusSummaryForUser } = require("../lib/focusSummary");
const { previewGoalPlanForUser } = require("../lib/goalPlanPreview");
const { listTasksForUser, createTaskForUser, updateTaskForUser, deleteTaskForUser } = require("../lib/taskQueries");
const { resolveTask } = require("../lib/taskResolver");
const { isV1ToolName, parseToolArgs } = require("./tools");

const DEFAULT_FOCUS_MINUTES = {
  focus: 25,
  short: 5,
  long: 15,
};

/**
 * @typedef {object} ToolContext
 * @property {string} userId
 * @property {number} [tzOffsetMinutes]
 */

/**
 * @typedef {object} ToolResult
 * @property {boolean} ok
 * @property {unknown} [data]
 * @property {string} summary
 * @property {string} [error]
 */

/**
 * @param {ToolResult} partial
 * @returns {ToolResult}
 */
function success(partial) {
  return {
    ok: true,
    data: partial.data ?? null,
    summary: partial.summary,
  };
}

/**
 * @param {string} error
 * @param {object} [opts]
 * @returns {ToolResult}
 */
function failure(error, opts = {}) {
  return {
    ok: false,
    data: opts.data ?? null,
    summary: opts.summary ?? error,
    error,
  };
}

function mapThrownError(err) {
  if (err instanceof PlanInputError) {
    return failure(err.message, { summary: err.message });
  }
  if (err?.code === "NOT_FOUND") {
    return failure(err.message, { summary: err.message });
  }
  if (err?.code === "FORBIDDEN") {
    return failure(err.message, { summary: err.message });
  }
  if (err?.code === "INVALID_DATE") {
    return failure(err.message, { summary: err.message });
  }
  console.error("toolExecutor unexpected error:", err);
  return failure("Internal tool error", { summary: "Something went wrong running that action." });
}

async function runListTasks(userId, args) {
  const tasks = await listTasksForUser(userId, args);
  const count = tasks.length;
  const done = tasks.filter((t) => t.status === "done").length;
  return success({
    data: { tasks, count },
    summary:
      count === 0
        ? "No tasks matched those filters."
        : `Found ${count} task${count === 1 ? "" : "s"} (${done} completed).`,
  });
}

async function runCreateTask(userId, args) {
  const task = await createTaskForUser(userId, args);
  const due =
    task.dueDate != null
      ? new Date(task.dueDate).toISOString()
      : null;
  return success({
    data: { task },
    summary: due
      ? `Created task "${task.title}" due ${due}.`
      : `Created task "${task.title}" with no due date.`,
  });
}

async function runGetFocusSummary(userId, ctx, args) {
  const tzOffsetMinutes =
    args.tzOffsetMinutes !== undefined
      ? args.tzOffsetMinutes
      : ctx.tzOffsetMinutes ?? 0;

  const payload = await getFocusSummaryForUser(userId, {
    tzOffsetMinutes,
    dateKey: args.date ?? null,
  });

  return success({
    data: payload,
    summary: `On ${payload.todayKey}: ${payload.todayMinutes} focus minute${payload.todayMinutes === 1 ? "" : "s"} logged; visit streak ${payload.streak} day${payload.streak === 1 ? "" : "s"}.`,
  });
}

function runSuggestFocusSession(args) {
  const mode = args.mode ?? "focus";
  const durationMinutes =
    args.durationMinutes ?? DEFAULT_FOCUS_MINUTES[mode] ?? 25;

  const clientAction = {
    type: "start_focus_session",
    mode,
    durationMinutes,
    label: args.label ?? null,
  };

  return success({
    data: {
      clientAction,
      note: "Focus timers run in the browser; the client action starts the session immediately.",
    },
    summary: `Starting a ${durationMinutes}-minute ${mode} session.`,
  });
}

async function runUpdateTask(userId, args) {
  const resolved = await resolveTask(userId, { taskId: args.taskId, taskTitle: args.taskTitle });
  if (!resolved.ok) {
    return failure(resolved.error, {
      summary: resolved.error,
      data: resolved.matches ? { matches: resolved.matches } : null,
    });
  }

  const task = resolved.task;
  const updated = await updateTaskForUser(task.id, args.updates);
  const changes = [];
  if (args.updates.title) changes.push(`renamed to "${updated.title}"`);
  if (args.updates.dueDate !== undefined) {
    changes.push(args.updates.dueDate ? `due date set to ${new Date(args.updates.dueDate).toISOString()}` : "due date cleared");
  }
  if (args.updates.status) changes.push(`status set to ${updated.status}`);

  return success({
    data: { task: updated },
    summary: `Updated "${updated.title}": ${changes.join(", ")}.`,
  });
}

async function runCompleteTask(userId, args) {
  const resolved = await resolveTask(userId, { taskId: args.taskId, taskTitle: args.taskTitle });
  if (!resolved.ok) {
    return failure(resolved.error, {
      summary: resolved.error,
      data: resolved.matches ? { matches: resolved.matches } : null,
    });
  }

  const task = resolved.task;
  if (task.status === "done") {
    return success({
      data: { task },
      summary: `"${task.title}" is already marked complete.`,
    });
  }

  const updated = await updateTaskForUser(task.id, { status: "done" });
  return success({
    data: { task: updated },
    summary: `Marked "${updated.title}" as complete.`,
  });
}

async function runDeleteTask(userId, args) {
  const resolved = await resolveTask(userId, { taskId: args.taskId, taskTitle: args.taskTitle });
  if (!resolved.ok) {
    return failure(resolved.error, {
      summary: resolved.error,
      data: resolved.matches ? { matches: resolved.matches } : null,
    });
  }

  const task = resolved.task;

  if (!args.confirmed) {
    return success({
      data: {
        pendingConfirmation: {
          type: "delete_task",
          taskId: task.id,
          taskTitle: task.title,
        },
      },
      summary: `Are you sure you want to delete "${task.title}"? Say "yes, delete it" to confirm.`,
    });
  }

  await deleteTaskForUser(task.id);
  return success({
    data: { deletedTaskId: task.id, deletedTitle: task.title },
    summary: `Deleted "${task.title}".`,
  });
}

async function runPreviewGoalPlan(userId, args) {
  const { goalId, startDate, availableDays, maxUnitsPerDay } = args;
  const preview = await previewGoalPlanForUser(userId, goalId, {
    startDate,
    availableDays,
    maxUnitsPerDay,
  });

  const itemCount = Array.isArray(preview.items) ? preview.items.length : 0;
  const risk = preview.planning?.riskLevel ?? "unknown";

  return success({
    data: preview,
    summary:
      itemCount === 0
        ? `Plan preview for "${preview.goal.title}": no schedulable items (risk: ${risk}). Nothing was saved.`
        : `Plan preview for "${preview.goal.title}": ${itemCount} proposed task group${itemCount === 1 ? "" : "s"} (risk: ${risk}). Preview only — not saved.`,
  });
}

/**
 * Execute a V1 agent tool for an authenticated user.
 *
 * @param {ToolContext} ctx
 * @param {string} toolName
 * @param {unknown} [rawArgs]
 * @returns {Promise<ToolResult>}
 */
async function executeTool(ctx, toolName, rawArgs) {
  if (!ctx?.userId || typeof ctx.userId !== "string") {
    return failure("Missing user context", {
      summary: "Tool execution requires an authenticated user.",
    });
  }

  if (!isV1ToolName(toolName)) {
    return failure(`Unknown tool: ${toolName}`, {
      summary: `Tool "${toolName}" is not available.`,
    });
  }

  const parsed = parseToolArgs(toolName, rawArgs);
  if (!parsed.ok) {
    return failure(parsed.error, { summary: parsed.error });
  }

  try {
    switch (toolName) {
      case "list_tasks":
        return await runListTasks(ctx.userId, parsed.args);
      case "create_task":
        return await runCreateTask(ctx.userId, parsed.args);
      case "update_task":
        return await runUpdateTask(ctx.userId, parsed.args);
      case "complete_task":
        return await runCompleteTask(ctx.userId, parsed.args);
      case "delete_task":
        return await runDeleteTask(ctx.userId, parsed.args);
      case "get_focus_summary":
        return await runGetFocusSummary(ctx.userId, ctx, parsed.args);
      case "suggest_focus_session":
        return runSuggestFocusSession(parsed.args);
      case "preview_goal_plan":
        return await runPreviewGoalPlan(ctx.userId, parsed.args);
      default:
        return failure(`Unknown tool: ${toolName}`, {
          summary: `Tool "${toolName}" is not available.`,
        });
    }
  } catch (err) {
    return mapThrownError(err);
  }
}

module.exports = {
  executeTool,
  DEFAULT_FOCUS_MINUTES,
};
