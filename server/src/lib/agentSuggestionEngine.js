const prisma = require("./prisma");
const { startOfDay } = require("./buildPlan");
const { runGoalAgent } = require("./goalAgentOrchestrator");
const { analyzeUserBehavior } = require("./userBehaviorAnalyzer");
const { loadUserBehaviorData } = require("./userBehaviorContext");

const DAY_CODES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const DEFAULT_LIMIT = 3;
const FOCUS_RECENT_DAYS = 7;
const FOCUS_PRIOR_DAYS = 7;
const MIN_FOCUS_SESSIONS_PER_PERIOD = 3;

const SEVERITY_WEIGHT = { high: 300, medium: 200, low: 100 };

/**
 * @param {number} count
 * @returns {"low"|"medium"|"high"}
 */
function severityFromCount(count, thresholds = [1, 3]) {
  if (count >= thresholds[1]) return "high";
  if (count >= thresholds[0]) return "medium";
  return "low";
}

/**
 * @param {Date} deadline
 * @param {Date} now
 * @returns {number}
 */
function deadlineUrgencyScore(deadline, now = new Date()) {
  if (!deadline) return 0;
  const ms = startOfDay(deadline).getTime() - startOfDay(now).getTime();
  const days = ms / (24 * 60 * 60 * 1000);
  if (days < 0) return 80;
  if (days <= 3) return 60;
  if (days <= 7) return 40;
  if (days <= 14) return 20;
  return 5;
}

function weekdayCode(dateLike) {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;
  return DAY_CODES[d.getUTCDay()];
}

function isOverdueTask(task, now = new Date()) {
  if (!task || task.status === "done" || !task.dueDate) return false;
  return startOfDay(new Date(task.dueDate)).getTime() < startOfDay(now).getTime();
}

function stripInternalFields(suggestion) {
  const { _rankScore, _dedupeKey, ...rest } = suggestion;
  return rest;
}

/**
 * @param {Array<object>} tasks
 * @param {Date} now
 */
function buildOverdueTasksSuggestion(tasks, now = new Date()) {
  const overdue = (tasks || []).filter((t) => isOverdueTask(t, now));
  if (overdue.length === 0) return null;

  const count = overdue.length;
  const severity = severityFromCount(count, [2, 5]);

  return {
    id: "overdue_tasks:global",
    type: "overdue_tasks",
    severity,
    title: count === 1 ? "1 overdue task" : `${count} overdue tasks`,
    message:
      count === 1
        ? "You have 1 incomplete task past its due date. Want help rescheduling it?"
        : `You have ${count} overdue incomplete tasks. Want help rescheduling them?`,
    recommendedAction: "reschedule_tasks",
    relatedGoalId: null,
    relatedGoalTitle: null,
    requiresConfirmation: true,
    sourceSignals: [`overdue_count:${count}`],
    _dedupeKey: "overdue_tasks:",
    _rankScore:
      SEVERITY_WEIGHT[severity] + Math.min(count * 5, 40) + 10,
  };
}

/**
 * @param {object} goal
 * @param {object} agentResult
 * @param {Date} now
 */
function buildGoalAgentSuggestions(goal, agentResult, now = new Date()) {
  const out = [];
  const evaluation = agentResult?.evaluation || {};
  const failureModes = agentResult?.failureAnalysis?.failureModes || [];
  const rec = agentResult?.rebalanceRecommendation || {};
  const goalId = goal.id;
  const title = goal.title;

  if (evaluation.behindSchedule) {
    const status = evaluation.status || "behind";
    const severity =
      status === "at_risk" ? "high" : status === "slightly_behind" ? "medium" : "medium";
    const missed = evaluation.missedTasks || 0;
    out.push({
      id: `goal_behind_schedule:${goalId}`,
      type: "goal_behind_schedule",
      severity,
      title: `"${title}" is behind schedule`,
      message: `Your "${title}" goal is ${status.replace(/_/g, " ")}${missed > 0 ? ` with ${missed} missed task${missed === 1 ? "" : "s"}` : ""}. Want me to preview a rebalance?`,
      recommendedAction: "preview_rebalance",
      relatedGoalId: goalId,
      relatedGoalTitle: title,
      requiresConfirmation: true,
      sourceSignals: [
        `behind_schedule:true`,
        `status:${status}`,
        `missed_tasks:${missed}`,
      ],
      _dedupeKey: `goal_behind_schedule:${goalId}`,
      _rankScore:
        SEVERITY_WEIGHT[severity] +
        deadlineUrgencyScore(goal.deadline, now) +
        missed * 3,
    });
  }

  if (
    rec.canRebalance === false &&
    (rec.recommendedAction === "extend_deadline" ||
      rec.recommendedAction === "reduce_scope")
  ) {
    const action = rec.recommendedAction;
    const severity = action === "reduce_scope" ? "high" : "medium";
    out.push({
      id: `impossible_goal:${goalId}`,
      type: "impossible_goal",
      severity,
      title: `"${title}" deadline looks too tight`,
      message:
        action === "extend_deadline"
          ? `Remaining work on "${title}" may not fit before the deadline. Consider extending the deadline or spreading work more evenly.`
          : `Remaining work on "${title}" may not fit before the deadline. You may need to reduce scope or extend the deadline.`,
      recommendedAction: action,
      relatedGoalId: goalId,
      relatedGoalTitle: title,
      requiresConfirmation: true,
      sourceSignals: [
        `can_rebalance:false`,
        `next_action:${action}`,
        rec.reason ? `reason:${rec.reason}` : null,
      ].filter(Boolean),
      _dedupeKey: `impossible_goal:${goalId}`,
      _rankScore:
        SEVERITY_WEIGHT[severity] + deadlineUrgencyScore(goal.deadline, now) + 15,
    });
  }

  if (failureModes.includes("overloaded_day")) {
    const severity = "medium";
    out.push({
      id: `overloaded_day:${goalId}`,
      type: "overloaded_day",
      severity,
      title: `Some days are overloaded on "${title}"`,
      message: `Your "${title}" plan stacks more work than your daily limit on some days. A rebalance preview could spread tasks more evenly.`,
      recommendedAction: "preview_rebalance",
      relatedGoalId: goalId,
      relatedGoalTitle: title,
      requiresConfirmation: true,
      sourceSignals: ["failure_mode:overloaded_day"],
      _dedupeKey: `overloaded_day:${goalId}`,
      _rankScore:
        SEVERITY_WEIGHT[severity] + deadlineUrgencyScore(goal.deadline, now) + 8,
    });
  }

  return out;
}

/**
 * @param {object} goal
 * @param {Array<object>} goalTasks
 * @param {object} behavior
 */
function buildBehaviorMismatchSuggestion(goal, goalTasks, behavior) {
  const dq = behavior?.dataQuality;
  if (!dq?.hasEnoughData || (dq.confidence ?? 0) < 0.4) return null;

  const strongest = behavior?.productivityPatterns?.strongestDays || [];
  const weakest = behavior?.productivityPatterns?.weakestDays || [];
  if (strongest.length === 0 || weakest.length === 0) return null;

  const incomplete = (goalTasks || []).filter(
    (t) => t.status !== "done" && t.dueDate
  );
  if (incomplete.length < 4) return null;

  const byDay = Object.fromEntries(DAY_CODES.map((d) => [d, 0]));
  for (const t of incomplete) {
    const code = weekdayCode(t.dueDate);
    if (code) byDay[code] += 1;
  }

  const weakLoad = weakest.reduce((s, d) => s + (byDay[d] || 0), 0);
  const strongLoad = strongest.reduce((s, d) => s + (byDay[d] || 0), 0);
  const total = incomplete.length;
  const weakShare = weakLoad / total;
  const strongShare = strongLoad / total;

  if (weakShare < 0.45 || strongShare > 0.35) return null;

  const severity = weakShare >= 0.6 ? "medium" : "low";
  const strongLabel = strongest.join(", ");
  const weakLabel = weakest.join(", ");

  return {
    id: `behavior_mismatch:${goal.id}`,
    type: "behavior_mismatch",
    severity,
    title: `"${goal.title}" may not match your rhythm`,
    message: `Your recent history shows stronger completion on ${strongLabel}, but much of "${goal.title}" is scheduled on ${weakLabel}. Consider redistributing tasks toward your stronger days.`,
    recommendedAction: "preview_adjustment",
    relatedGoalId: goal.id,
    relatedGoalTitle: goal.title,
    requiresConfirmation: true,
    sourceSignals: [
      `strongest_days:${strongLabel}`,
      `weakest_days:${weakLabel}`,
      `weak_day_task_share:${Math.round(weakShare * 100)}`,
      `confidence:${dq.confidence}`,
    ],
    _dedupeKey: `behavior_mismatch:${goal.id}`,
    _rankScore:
      SEVERITY_WEIGHT[severity] +
      Math.round(weakShare * 30) +
      Math.round((dq.confidence || 0) * 20),
  };
}

/**
 * @param {Array<object>} focusSessions
 * @param {Date} now
 */
function buildFocusDropoffSuggestion(focusSessions, now = new Date()) {
  const sessions = Array.isArray(focusSessions) ? focusSessions : [];
  const nowDay = startOfDay(now).getTime();
  const recentStart = nowDay - FOCUS_RECENT_DAYS * 24 * 60 * 60 * 1000;
  const priorStart =
    nowDay - (FOCUS_RECENT_DAYS + FOCUS_PRIOR_DAYS) * 24 * 60 * 60 * 1000;

  let recentMinutes = 0;
  let recentCount = 0;
  let priorMinutes = 0;
  let priorCount = 0;

  for (const s of sessions) {
    const started = s?.startedAt ? new Date(s.startedAt) : null;
    if (!started || Number.isNaN(started.getTime())) continue;
    const t = started.getTime();
    const mins = Number(s.duration) || 0;
    if (t >= recentStart && t < nowDay + 24 * 60 * 60 * 1000) {
      recentMinutes += mins;
      recentCount += 1;
    } else if (t >= priorStart && t < recentStart) {
      priorMinutes += mins;
      priorCount += 1;
    }
  }

  if (
    recentCount < MIN_FOCUS_SESSIONS_PER_PERIOD ||
    priorCount < MIN_FOCUS_SESSIONS_PER_PERIOD
  ) {
    return null;
  }

  if (priorMinutes <= 0) return null;
  const ratio = recentMinutes / priorMinutes;
  if (ratio > 0.55) return null;

  const severity = ratio < 0.35 ? "medium" : "low";
  const pctDrop = Math.round((1 - ratio) * 100);

  return {
    id: "focus_dropoff:global",
    type: "focus_dropoff",
    severity,
    title: "Recent focus time is down",
    message: `Your focus minutes dropped about ${pctDrop}% compared to the prior week. A short focus block today could help you rebuild momentum.`,
    recommendedAction: "start_focus_session",
    relatedGoalId: null,
    relatedGoalTitle: null,
    requiresConfirmation: true,
    sourceSignals: [
      `recent_focus_minutes:${recentMinutes}`,
      `prior_focus_minutes:${priorMinutes}`,
      `recent_sessions:${recentCount}`,
      `prior_sessions:${priorCount}`,
    ],
    _dedupeKey: "focus_dropoff:",
    _rankScore: SEVERITY_WEIGHT[severity] + Math.min(pctDrop, 40),
  };
}

/**
 * Pure suggestion assembly (testable).
 *
 * @param {object} input
 */
function generateAgentSuggestions({
  tasks = [],
  goals = [],
  goalAgentResults = [],
  behavior = null,
  focusSessions = [],
  now = new Date(),
  limit = DEFAULT_LIMIT,
} = {}) {
  const candidates = [];

  const overdue = buildOverdueTasksSuggestion(tasks, now);
  if (overdue) candidates.push(overdue);

  const tasksByGoal = new Map();
  for (const t of tasks) {
    if (!t.goalId) continue;
    if (!tasksByGoal.has(t.goalId)) tasksByGoal.set(t.goalId, []);
    tasksByGoal.get(t.goalId).push(t);
  }

  for (const { goal, agentResult } of goalAgentResults) {
    candidates.push(...buildGoalAgentSuggestions(goal, agentResult, now));
    const mismatch = buildBehaviorMismatchSuggestion(
      goal,
      tasksByGoal.get(goal.id) || [],
      behavior
    );
    if (mismatch) candidates.push(mismatch);
  }

  const focus = buildFocusDropoffSuggestion(focusSessions, now);
  if (focus) candidates.push(focus);

  const impossibleGoalIds = new Set(
    candidates
      .filter((c) => c.type === "impossible_goal" && c.relatedGoalId)
      .map((c) => c.relatedGoalId)
  );

  const seen = new Set();
  const deduped = candidates.filter((c) => {
    if (
      c.type === "goal_behind_schedule" &&
      c.relatedGoalId &&
      impossibleGoalIds.has(c.relatedGoalId)
    ) {
      return false;
    }
    const key = c._dedupeKey || `${c.type}:${c.relatedGoalId || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  deduped.sort((a, b) => (b._rankScore || 0) - (a._rankScore || 0));

  const cap = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), 10);
  return {
    suggestions: deduped.slice(0, cap).map(stripInternalFields),
  };
}

/**
 * @param {string} userId
 * @param {{ limit?: number, tzOffsetMinutes?: number, lookbackDays?: number }} [opts]
 */
async function getAgentSuggestionsForUser(
  userId,
  { limit = DEFAULT_LIMIT, tzOffsetMinutes = 0, lookbackDays = 30 } = {}
) {
  const now = new Date();

  const [tasks, goals, behaviorBundle, focusSessions] = await Promise.all([
    prisma.task.findMany({
      where: { userId },
      select: {
        id: true,
        title: true,
        status: true,
        dueDate: true,
        completedAt: true,
        goalId: true,
        unitStart: true,
        unitEnd: true,
      },
      take: 5000,
    }),
    prisma.goal.findMany({
      where: { userId },
      select: {
        id: true,
        title: true,
        userId: true,
        createdAt: true,
        deadline: true,
        availableDays: true,
        maxUnitsPerDay: true,
        totalUnits: true,
        unitName: true,
      },
      take: 100,
    }),
    loadUserBehaviorData(userId, { lookbackDays, now }),
    prisma.focusSession.findMany({
      where: {
        userId,
        startedAt: {
          gte: new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000),
          lte: now,
        },
      },
      select: { duration: true, startedAt: true },
      take: 5000,
    }),
  ]);

  const behavior = analyzeUserBehavior({
    tasks: behaviorBundle.tasks,
    focusSessions: behaviorBundle.focusSessions,
    goals: behaviorBundle.goals,
    agentRuns: behaviorBundle.agentRuns,
    now,
    tzOffsetMinutes,
    lookbackDays: behaviorBundle.lookbackDays,
  });

  const goalAgentResults = goals.map((goal) => {
    const goalTasks = tasks.filter((t) => t.goalId === goal.id);
    return {
      goal,
      agentResult: runGoalAgent({ goal, tasks: goalTasks, now }),
    };
  });

  return generateAgentSuggestions({
    tasks,
    goals,
    goalAgentResults,
    behavior,
    focusSessions,
    now,
    limit,
  });
}

module.exports = {
  generateAgentSuggestions,
  getAgentSuggestionsForUser,
  buildOverdueTasksSuggestion,
  buildGoalAgentSuggestions,
  buildBehaviorMismatchSuggestion,
  buildFocusDropoffSuggestion,
  isOverdueTask,
};
