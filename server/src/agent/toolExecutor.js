const { PlanInputError } = require("../lib/buildPlan");
const { getFocusSummaryForUser } = require("../lib/focusSummary");
const { getUserBehaviorContextForUser } = require("../lib/userBehaviorContext");
const { previewGoalPlanForUser } = require("../lib/goalPlanPreview");
const { listTasksForUser, createTaskForUser, updateTaskForUser, deleteTaskForUser } = require("../lib/taskQueries");
const { createGoalForUser, confirmGoalPlanForUser } = require("../lib/goalQueries");
const {
  listGoalsForUser,
  getGoalAgentPreviewForUser,
  applyGoalRebalanceForUser,
} = require("../lib/goalAgentQueries");
const {
  previewGoalAdjustmentForUser,
  applyGoalAdjustmentForUser,
} = require("../lib/goalAdjustmentQueries");
const { getAgentSuggestionsForUser } = require("../lib/agentSuggestionEngine");
const { evaluateOutcomesForUser } = require("../lib/agentOutcomeEvaluator");
const { getAgentStrategyStatsForUser } = require("../lib/agentStrategyStats");
const { getAdaptiveRecommendationForUser } = require("../lib/adaptiveRecommendationContext");
const { parseGoalDeadline } = require("../lib/goalDeadlineParser");
const {
  retrieveRelevantMemories,
  storeMemory,
  listMemories,
  deleteMemory,
  deleteMemoriesByQuery,
} = require("../memory/mem0Service");
const {
  formatCreatedTaskSummary,
  formatLocalDateTime,
  formatUpdatedScheduleSummary,
} = require("../lib/agentMessageFormat");
const {
  resolveGoal,
  normalizeGoalLookupArgs,
  looksLikeInventedSlug,
} = require("../lib/goalResolver");
const { isV1ToolName, parseToolArgs } = require("./tools");
const {
  runCalendarCreateEvent,
  runCalendarListEvents,
} = require("../integrations/composio/calendarTools");
const {
  runGmailSendEmail,
  runGmailCreateDraft,
} = require("../integrations/composio/gmailTools");
const {
  runNotionCreatePage,
  runNotionExportGoal,
} = require("../integrations/composio/notionTools");

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
  if (err?.code === "VALIDATION") {
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
  if (err?.code === "ALREADY_PLANNED") {
    return failure(err.message, { summary: err.message });
  }
  if (err?.code === "CANNOT_REBALANCE") {
    return failure(err.message, {
      summary: err.message,
      data: {
        nextAction: err.nextAction,
        agentResult: err.agentResult,
      },
    });
  }
  if (err?.code === "ADJUSTMENT_NOT_FEASIBLE") {
    return failure(err.message, {
      summary: err.message,
      data: { preview: err.preview },
    });
  }
  console.error("toolExecutor unexpected error:", err);
  return failure("Internal tool error", { summary: "Something went wrong running that action." });
}

function goalLookupFailure(resolved) {
  return failure(resolved.error, {
    summary: resolved.error,
    data: resolved.matches ? { matches: resolved.matches } : null,
  });
}

async function runListTasks(userId, args) {
  let queryArgs = { ...args };
  let resolvedGoal = null;

  if (args.goalId || args.goalTitle) {
    const resolved = await resolveGoal(userId, normalizeGoalLookupArgs(args));
    if (!resolved.ok) return goalLookupFailure(resolved);
    resolvedGoal = resolved.goal;
    queryArgs = { ...args, goalId: resolved.goal.id };
    delete queryArgs.goalTitle;
  }

  const tasks = await listTasksForUser(userId, queryArgs);
  const count = tasks.length;
  const done = tasks.filter((t) => t.status === "done").length;

  let summary;
  if (resolvedGoal) {
    const matchNote = args.goalTitle || looksLikeInventedSlug(args.goalId)
      ? ` (matched from "${args.goalTitle || args.goalId}")`
      : "";
    summary =
      count === 0
        ? `No tasks found for goal "${resolvedGoal.title}" (id ${resolvedGoal.id})${matchNote}.`
        : `Found ${count} task${count === 1 ? "" : "s"} for goal "${resolvedGoal.title}" (id ${resolvedGoal.id}, ${done} completed)${matchNote}.`;
  } else {
    summary =
      count === 0
        ? "No tasks matched those filters."
        : `Found ${count} task${count === 1 ? "" : "s"} (${done} completed).`;
  }

  return success({
    data: {
      tasks,
      count,
      ...(resolvedGoal
        ? { goalId: resolvedGoal.id, goalTitle: resolvedGoal.title }
        : {}),
    },
    summary,
  });
}

async function runCreateTask(userId, args, ctx = {}) {
  const task = await createTaskForUser(userId, args);
  const tzOffsetMinutes = ctx.tzOffsetMinutes ?? 0;
  return success({
    data: { task },
    summary: formatCreatedTaskSummary(task, tzOffsetMinutes),
  });
}

async function runGetUserBehaviorContext(userId, ctx, args) {
  const tzOffsetMinutes =
    args.tzOffsetMinutes !== undefined
      ? args.tzOffsetMinutes
      : ctx.tzOffsetMinutes ?? 0;

  const payload = await getUserBehaviorContextForUser(userId, {
    lookbackDays: args.lookbackDays,
    tzOffsetMinutes,
  });

  const quality = payload.signals?.dataQuality;
  const qualityNote = quality?.hasEnoughData
    ? `confidence ${quality.confidence}`
    : "insufficient history";

  return success({
    data: payload,
    summary: `Behavior context (${payload.lookbackDays}d, ${qualityNote}): ${payload.summary}`,
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

async function runUpdateTask(userId, args, ctx = {}) {
  const resolved = await resolveTask(userId, { taskId: args.taskId, taskTitle: args.taskTitle });
  if (!resolved.ok) {
    return failure(resolved.error, {
      summary: resolved.error,
      data: resolved.matches ? { matches: resolved.matches } : null,
    });
  }

  const task = resolved.task;
  const updated = await updateTaskForUser(task.id, args.updates);
  const tzOffsetMinutes = ctx.tzOffsetMinutes ?? 0;
  const changes = [];
  if (args.updates.title) changes.push(`renamed to "${updated.title}"`);
  if (args.updates.dueDate !== undefined) {
    changes.push(
      args.updates.dueDate
        ? `due date set to ${formatLocalDateTime(args.updates.dueDate, tzOffsetMinutes)}`
        : "due date cleared"
    );
  }
  if (args.updates.startTime !== undefined || args.updates.endTime !== undefined) {
    if (updated.startTime && updated.endTime) {
      changes.push(
        `scheduled for ${formatUpdatedScheduleSummary(updated.startTime, updated.endTime, tzOffsetMinutes)}`
      );
    } else {
      changes.push("schedule cleared");
    }
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

async function runCreateGoal(userId, ctx, args) {
  let deadlineIso;
  try {
    deadlineIso = parseGoalDeadline(args.deadline, ctx.tzOffsetMinutes ?? 0);
  } catch (err) {
    return failure(err.message, { summary: err.message });
  }

  const goal = await createGoalForUser(userId, {
    ...args,
    deadline: deadlineIso,
    unitName: args.unitName ?? "units",
  });

  const deadlineLabel = new Date(goal.deadline).toISOString().slice(0, 10);
  return success({
    data: { goal },
    summary: `Created goal "${goal.title}" (${goal.totalUnits} ${goal.unitName}, deadline ${deadlineLabel}).`,
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

  const data = { ...preview };
  if (itemCount > 0) {
    data.pendingConfirmation = {
      type: "confirm_goal_plan",
      goalId: preview.goal.id,
      goalTitle: preview.goal.title,
      itemCount,
    };
  }

  return success({
    data,
    summary:
      itemCount === 0
        ? `Plan preview for "${preview.goal.title}": no schedulable items (risk: ${risk}). Nothing was saved.`
        : `Plan preview for "${preview.goal.title}": ${itemCount} proposed task group${itemCount === 1 ? "" : "s"} (risk: ${risk}). Say "yes, create it" to schedule tasks.`,
  });
}

function rebalanceChangeCount(rebalanceRecommendation) {
  return Array.isArray(rebalanceRecommendation?.changes)
    ? rebalanceRecommendation.changes.length
    : 0;
}

function buildApplyRebalancePending(goalId, goalTitle, changeCount) {
  return {
    type: "apply_goal_rebalance",
    goalId,
    goalTitle,
    changeCount,
  };
}

async function runListGoals(userId, args) {
  const status = args.status ?? "active";
  const goals = await listGoalsForUser(userId, { status });
  const count = goals.length;

  const goalLines =
    count > 0
      ? goals
          .map(
            (g) =>
              `"${g.title}" (goalId=${g.goalId}, ${g.taskCounts.total} tasks, ${g.taskCounts.incomplete} incomplete)`
          )
          .join("; ")
      : "";

  return success({
    data: { goals, count, status },
    summary:
      count === 0
        ? `No ${status === "all" ? "" : `${status} `}goals found.`
        : `Found ${count} ${status === "all" ? "" : `${status} `}goal${count === 1 ? "" : "s"}: ${goalLines}. Use the exact goalId for previews and task filters.`,
  });
}

async function runGetGoalAgentPreview(userId, args, ctx = {}) {
  const lookup = normalizeGoalLookupArgs(args);
  const resolved = await resolveGoal(userId, lookup);
  if (!resolved.ok) return goalLookupFailure(resolved);

  const preview = await getGoalAgentPreviewForUser(userId, resolved.goal.id, {
    logRun: true,
    source: "chat",
    tzOffsetMinutes: ctx?.tzOffsetMinutes ?? 0,
  });

  const rec = preview.rebalanceRecommendation;
  const changeCount = rebalanceChangeCount(rec);
  const data = { ...preview };

  if (rec?.canRebalance && changeCount > 0) {
    data.pendingConfirmation = buildApplyRebalancePending(
      preview.goalId,
      preview.goalTitle,
      changeCount
    );
  }

  const action = preview.nextAction;
  let summary;
  const matchNote =
    lookup.goalTitle || looksLikeInventedSlug(args.goalId)
      ? ` Matched goal "${resolved.goal.title}" from your description.`
      : "";

  const adaptive = preview.adaptiveRanking;
  const adaptiveNote =
    adaptive?.explanation && adaptive.adaptationUsed
      ? ` ${adaptive.explanation}`
      : adaptive && !adaptive.adaptationUsed
        ? " I do not have enough outcome history yet to personalize from past accepted recommendations."
        : "";

  if (rec?.canRebalance && changeCount > 0) {
    summary = `Rebalance preview for "${preview.goalTitle}": ${changeCount} task date change${changeCount === 1 ? "" : "s"} proposed.${matchNote}${adaptiveNote} Say "yes, apply it" to confirm.`;
  } else if (action === "extend_deadline" || action === "reduce_scope") {
    summary = `Rebalance preview for "${preview.goalTitle}": automatic reschedule is not feasible. Suggested next step: ${action.replace(/_/g, " ")}.${adaptiveNote}`;
  } else if (action === "keep_plan") {
    summary = `Rebalance preview for "${preview.goalTitle}": no schedule changes needed.${adaptiveNote}`;
  } else {
    summary = `Rebalance preview for "${preview.goalTitle}" (next action: ${action}).${adaptiveNote}`;
  }

  return success({ data, summary });
}

async function runApplyGoalRebalance(userId, args) {
  const lookup = normalizeGoalLookupArgs(args);
  const resolved = await resolveGoal(userId, lookup);
  if (!resolved.ok) return goalLookupFailure(resolved);

  let preview;
  try {
    preview = await getGoalAgentPreviewForUser(userId, resolved.goal.id, {
      logRun: false,
      source: null,
    });
  } catch (err) {
    return mapThrownError(err);
  }

  const rec = preview.rebalanceRecommendation;
  const changeCount = rebalanceChangeCount(rec);

  if (!rec?.canRebalance || changeCount === 0) {
    const action = preview.nextAction || "manual_review";
    return failure(rec?.reason || "Rebalance cannot be applied.", {
      summary:
        action === "extend_deadline" || action === "reduce_scope"
          ? `Cannot auto-rebalance "${preview.goalTitle}". Suggested next step: ${action.replace(/_/g, " ")}.`
          : `Cannot auto-rebalance "${preview.goalTitle}".`,
      data: {
        nextAction: action,
        evaluation: preview.evaluation,
        rebalanceRecommendation: rec,
      },
    });
  }

  if (!args.confirmed) {
    return success({
      data: {
        preview,
        pendingConfirmation: buildApplyRebalancePending(
          preview.goalId,
          preview.goalTitle,
          changeCount
        ),
      },
      summary: `Ready to apply ${changeCount} due-date change${changeCount === 1 ? "" : "s"} for "${preview.goalTitle}". Say "yes, apply it" to confirm.`,
    });
  }

  try {
    const applied = await applyGoalRebalanceForUser(userId, resolved.goal.id);
    return success({
      data: applied,
      summary: `Applied rebalance for "${applied.goalTitle}": updated ${applied.changeCount} task due date${applied.changeCount === 1 ? "" : "s"}.`,
    });
  } catch (err) {
    return mapThrownError(err);
  }
}

function pickAdjustmentOpts(args) {
  const opts = {};
  if (args.deadline !== undefined) opts.deadline = args.deadline;
  if (args.maxUnitsPerDay !== undefined) opts.maxUnitsPerDay = args.maxUnitsPerDay;
  if (args.spreadEvenly !== undefined) opts.spreadEvenly = args.spreadEvenly;
  return opts;
}

function buildApplyAdjustmentPending(goalId, goalTitle, itemCount, adjustmentOpts) {
  return {
    type: "apply_goal_adjustment",
    goalId,
    goalTitle,
    itemCount,
    ...adjustmentOpts,
  };
}

async function runPreviewGoalAdjustment(userId, ctx, args) {
  const lookup = normalizeGoalLookupArgs(args);
  const resolved = await resolveGoal(userId, lookup);
  if (!resolved.ok) return goalLookupFailure(resolved);

  const adjustmentOpts = pickAdjustmentOpts(args);
  let preview;
  try {
    preview = await previewGoalAdjustmentForUser(
      userId,
      resolved.goal.id,
      adjustmentOpts,
      ctx.tzOffsetMinutes ?? 0
    );
  } catch (err) {
    return mapThrownError(err);
  }

  const itemCount = Array.isArray(preview.items) ? preview.items.length : 0;
  const data = { ...preview };

  if (preview.feasible && itemCount > 0) {
    data.pendingConfirmation = buildApplyAdjustmentPending(
      preview.goalId,
      preview.goalTitle,
      itemCount,
      adjustmentOpts
    );
  }

  const deadlineLabel = preview.proposed?.deadline
    ? new Date(preview.proposed.deadline).toISOString().slice(0, 10)
    : null;

  let summary;
  if (!preview.feasible) {
    summary = preview.reason || `Cannot adjust "${preview.goalTitle}" with those settings.`;
  } else {
    const load = preview.proposed?.estimatedAvgUnitsPerDay;
    summary = `Adjustment preview for "${preview.goalTitle}": ${itemCount} task group${itemCount === 1 ? "" : "s"} for ${preview.remainingUnits} remaining units${deadlineLabel ? `, deadline ${deadlineLabel}` : ""}${load != null ? `, ~${load} units/day avg` : ""}. Say "yes, apply it" to confirm.`;
  }

  return success({ data, summary });
}

async function runApplyGoalAdjustment(userId, ctx, args) {
  const lookup = normalizeGoalLookupArgs(args);
  const resolved = await resolveGoal(userId, lookup);
  if (!resolved.ok) return goalLookupFailure(resolved);

  const adjustmentOpts = pickAdjustmentOpts(args);

  let preview;
  try {
    preview = await previewGoalAdjustmentForUser(
      userId,
      resolved.goal.id,
      adjustmentOpts,
      ctx.tzOffsetMinutes ?? 0
    );
  } catch (err) {
    return mapThrownError(err);
  }

  const itemCount = Array.isArray(preview.items) ? preview.items.length : 0;

  if (!preview.feasible || itemCount === 0) {
    return failure(preview.reason || "Goal adjustment is not feasible.", {
      summary: preview.reason || "Goal adjustment is not feasible.",
      data: { preview },
    });
  }

  if (!args.confirmed) {
    return success({
      data: {
        preview,
        pendingConfirmation: buildApplyAdjustmentPending(
          preview.goalId,
          preview.goalTitle,
          itemCount,
          adjustmentOpts
        ),
      },
      summary: `Ready to replan "${preview.goalTitle}" (${itemCount} task groups). Say "yes, apply it" to confirm.`,
    });
  }

  try {
    const applied = await applyGoalAdjustmentForUser(
      userId,
      resolved.goal.id,
      adjustmentOpts,
      ctx.tzOffsetMinutes ?? 0
    );
    return success({
      data: applied,
      summary: `Adjusted "${applied.goalTitle}": created ${applied.createdCount} new tasks for remaining work. Completed tasks were kept.`,
    });
  } catch (err) {
    return mapThrownError(err);
  }
}

async function runEvaluateAgentOutcomes(userId, args) {
  const lookbackDays = args.lookbackDays ?? 30;
  const summary = await evaluateOutcomesForUser(userId, { lookbackDays });

  const parts = [];
  if (summary.evaluatedCount > 0) {
    parts.push(
      `Evaluated ${summary.evaluatedCount} accepted recommendation${summary.evaluatedCount === 1 ? "" : "s"}`
    );
    if (summary.improvedCount > 0) {
      parts.push(`${summary.improvedCount} improved`);
    }
    if (summary.neutralCount > 0) {
      parts.push(`${summary.neutralCount} neutral`);
    }
    if (summary.worsenedCount > 0) {
      parts.push(`${summary.worsenedCount} worsened`);
    }
  }
  if (summary.insufficientDataCount > 0 && summary.evaluatedCount === 0) {
    parts.push(
      `${summary.insufficientDataCount} run${summary.insufficientDataCount === 1 ? "" : "s"} need more time or data before outcomes can be scored`
    );
  } else if (summary.pendingCount > 0) {
    parts.push(
      `${summary.pendingCount} still waiting for enough time since acceptance`
    );
  }
  if (parts.length === 0) {
    parts.push("No accepted agent runs are pending outcome evaluation.");
  }

  const { results, pendingCount, ...counts } = summary;
  return success({
    data: { ...counts, results },
    summary: parts.join("; ") + ".",
  });
}

async function runGetAgentStrategyMemory(userId, args) {
  const lookbackDays = args.lookbackDays ?? 90;
  const payload = await getAgentStrategyStatsForUser(userId, { lookbackDays });

  if (!payload.hasEnoughData) {
    return success({
      data: payload,
      summary:
        "I do not have enough outcome history yet to say which strategies have worked best for you.",
    });
  }

  const highlights = payload.strategyStats
    .filter((row) => row.evaluatedOutcomes > 0 && row.successRate != null)
    .sort((a, b) => (b.successRate ?? 0) - (a.successRate ?? 0))
    .slice(0, 2)
    .map((row) => {
      const pct = Math.round((row.successRate ?? 0) * 100);
      return `${row.strategy} (${pct}% improved, n=${row.evaluatedOutcomes})`;
    });

  const summary =
    highlights.length > 0
      ? `Strategy memory from ${payload.evaluatedAcceptedCount} evaluated outcomes: ${highlights.join("; ")}.`
      : "Some outcome history exists, but no strategy has enough evaluated results yet.";

  return success({ data: payload, summary });
}

async function runGetAdaptiveRecommendation(userId, ctx, args) {
  const lookup = normalizeGoalLookupArgs(args);
  let goalId = lookup.goalId || null;

  if (!goalId && (lookup.goalTitle || args.goalTitle)) {
    const resolved = await resolveGoal(userId, lookup);
    if (!resolved.ok) return goalLookupFailure(resolved);
    goalId = resolved.goal.id;
  }

  const payload = await getAdaptiveRecommendationForUser(userId, {
    goalId,
    tzOffsetMinutes: ctx.tzOffsetMinutes ?? 0,
    lookbackDays: args.lookbackDays ?? 30,
  });

  const ranking = payload.adaptiveRanking;
  const action = ranking?.recommendedAction || "manual_review";
  const title = payload.goalTitle ? `"${payload.goalTitle}"` : "your goals";

  let summary;
  if (!payload.goalId) {
    summary =
      "No goals found yet. Create a goal first, then I can recommend next steps.";
  } else if (ranking?.adaptationUsed) {
    summary = `For ${title}, recommended next step: ${action.replace(/_/g, " ")}. ${ranking.explanation}`;
  } else {
    summary = `For ${title}, recommended next step: ${action.replace(/_/g, " ")} based on current goal data. I do not have enough outcome history yet to personalize from past accepted recommendations.`;
  }

  return success({ data: payload, summary });
}

async function runGetAgentSuggestions(userId, ctx, args) {
  const limit = args.limit ?? 3;
  const payload = await getAgentSuggestionsForUser(userId, {
    limit,
    tzOffsetMinutes: ctx.tzOffsetMinutes ?? 0,
  });

  const count = payload.suggestions?.length ?? 0;
  return success({
    data: payload,
    summary:
      count === 0
        ? "No proactive suggestions right now — you look on track."
        : `Found ${count} suggestion${count === 1 ? "" : "s"}: ${payload.suggestions.map((s) => s.title).join("; ")}.`,
  });
}

async function runConfirmGoalPlan(userId, args) {
  const preview = await previewGoalPlanForUser(userId, args.goalId, {});
  const itemCount = Array.isArray(preview.items) ? preview.items.length : 0;

  if (itemCount === 0) {
    return failure("Plan is not feasible for this goal. Adjust deadline or constraints.", {
      summary: "Plan is not feasible for this goal. Adjust deadline or constraints.",
      data: { preview },
    });
  }

  if (!args.confirmed) {
    return success({
      data: {
        preview,
        pendingConfirmation: {
          type: "confirm_goal_plan",
          goalId: preview.goal.id,
          goalTitle: preview.goal.title,
          itemCount,
        },
      },
      summary: `Ready to create ${itemCount} scheduled tasks for "${preview.goal.title}". Say "yes, create it" to confirm.`,
    });
  }

  const created = await confirmGoalPlanForUser(userId, args.goalId, {
    items: preview.items,
    availableDays: preview.goal.availableDays,
    maxUnitsPerDay: preview.goal.maxUnitsPerDay,
  });

  return success({
    data: {
      goalId: args.goalId,
      createdCount: created.length,
      tasks: created,
    },
    summary: `Created ${created.length} scheduled tasks for "${preview.goal.title}".`,
  });
}

async function runRetrieveMemory(userId, args) {
  const memories = await retrieveRelevantMemories({
    userId,
    query: args.query,
    limit: args.limit,
  });
  if (memories.length === 0) {
    return success({
      data: { memories: [] },
      summary: "No relevant stored preferences found for that query.",
    });
  }
  const lines = memories.map((m) => `• ${m.content}`);
  return success({
    data: { memories },
    summary: `Relevant preferences:\n${lines.join("\n")}`,
  });
}

async function runStoreMemory(userId, args) {
  const result = await storeMemory({
    userId,
    content: args.content,
    metadata: { source: "agent_tool" },
  });
  if (!result.ok) {
    return failure(result.error, { summary: result.error });
  }
  return success({
    data: { memory: result.memory },
    summary: `Saved preference: "${result.memory.content}"`,
  });
}

async function runListMemories(userId, args) {
  const memories = await listMemories({ userId, limit: args.limit });
  if (memories.length === 0) {
    return success({
      data: { memories: [] },
      summary: "I don't have any stored preferences for you yet.",
    });
  }
  const lines = memories.map((m) => `• ${m.content}`);
  return success({
    data: { memories },
    summary: `Here's what I remember about your preferences:\n${lines.join("\n")}`,
  });
}

async function runDeleteMemory(userId, args) {
  if (args.memoryId) {
    const result = await deleteMemory({ userId, memoryId: args.memoryId });
    if (!result.ok) {
      return failure(result.error, { summary: result.error });
    }
    return success({
      data: { deletedId: result.deletedId },
      summary: "Removed that preference from memory.",
    });
  }

  const result = await deleteMemoriesByQuery({
    userId,
    query: args.query,
  });
  if (!result.ok) {
    return failure(result.error, { summary: result.error });
  }
  const titles = result.deleted.map((m) => m.content).join("; ");
  return success({
    data: { deleted: result.deleted },
    summary: `Forgot: ${titles}`,
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
        return await runCreateTask(ctx.userId, parsed.args, ctx);
      case "update_task":
        return await runUpdateTask(ctx.userId, parsed.args, ctx);
      case "complete_task":
        return await runCompleteTask(ctx.userId, parsed.args);
      case "delete_task":
        return await runDeleteTask(ctx.userId, parsed.args);
      case "get_focus_summary":
        return await runGetFocusSummary(ctx.userId, ctx, parsed.args);
      case "get_user_behavior_context":
        return await runGetUserBehaviorContext(ctx.userId, ctx, parsed.args);
      case "suggest_focus_session":
        return runSuggestFocusSession(parsed.args);
      case "create_goal":
        return await runCreateGoal(ctx.userId, ctx, parsed.args);
      case "preview_goal_plan":
        return await runPreviewGoalPlan(ctx.userId, parsed.args);
      case "confirm_goal_plan":
        return await runConfirmGoalPlan(ctx.userId, parsed.args);
      case "list_goals":
        return await runListGoals(ctx.userId, parsed.args);
      case "get_goal_agent_preview":
        return await runGetGoalAgentPreview(ctx.userId, parsed.args, ctx);
      case "apply_goal_rebalance":
        return await runApplyGoalRebalance(ctx.userId, parsed.args);
      case "preview_goal_adjustment":
        return await runPreviewGoalAdjustment(ctx.userId, ctx, parsed.args);
      case "apply_goal_adjustment":
        return await runApplyGoalAdjustment(ctx.userId, ctx, parsed.args);
      case "get_agent_suggestions":
        return await runGetAgentSuggestions(ctx.userId, ctx, parsed.args);
      case "evaluate_agent_outcomes":
        return await runEvaluateAgentOutcomes(ctx.userId, parsed.args);
      case "get_agent_strategy_memory":
        return await runGetAgentStrategyMemory(ctx.userId, parsed.args);
      case "get_adaptive_recommendation":
        return await runGetAdaptiveRecommendation(ctx.userId, ctx, parsed.args);
      case "retrieve_memory":
        return await runRetrieveMemory(ctx.userId, parsed.args);
      case "store_memory":
        return await runStoreMemory(ctx.userId, parsed.args);
      case "list_memories":
        return await runListMemories(ctx.userId, parsed.args);
      case "delete_memory":
        return await runDeleteMemory(ctx.userId, parsed.args);
      case "calendar_create_event":
        return await runCalendarCreateEvent(ctx.userId, parsed.args);
      case "calendar_list_events":
        return await runCalendarListEvents(ctx.userId, parsed.args);
      case "gmail_send_email":
        return await runGmailSendEmail(ctx.userId, parsed.args);
      case "gmail_create_draft":
        return await runGmailCreateDraft(ctx.userId, parsed.args);
      case "notion_create_page":
        return await runNotionCreatePage(ctx.userId, parsed.args);
      case "notion_export_goal":
        return await runNotionExportGoal(ctx.userId, parsed.args);
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
