const prisma = require("./prisma");
const { evaluateGoalProgress } = require("./evaluationEngine");

const MIN_EVAL_HOURS = 24;
const COMPLETION_IMPROVE_THRESHOLD = 0.02;
const COMPLETION_WORSEN_THRESHOLD = -0.02;

const OUTCOME_STATUS = {
  NOT_CHECKED: "not_checked",
  IMPROVED: "improved",
  NEUTRAL: "neutral",
  WORSENED: "worsened",
  INSUFFICIENT_DATA: "insufficient_data",
};

const GOAL_SELECT = {
  id: true,
  userId: true,
  title: true,
  deadline: true,
  totalUnits: true,
  createdAt: true,
  availableDays: true,
  maxUnitsPerDay: true,
};

const TASK_SELECT = {
  id: true,
  goalId: true,
  title: true,
  status: true,
  dueDate: true,
  unitStart: true,
  unitEnd: true,
};

function round4(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10000) / 10000;
}

function hoursSince(dateLike, now) {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return Infinity;
  return (now.getTime() - d.getTime()) / (60 * 60 * 1000);
}

function readBeforeMetrics(agentRun) {
  const ev = agentRun?.evaluation;
  if (!ev || typeof ev !== "object") {
    return { completionRateBefore: null, missedTasksBefore: null };
  }
  const completionRateBefore = Number(ev.completionRate);
  const missedTasksBefore = Number(ev.missedTasks);
  return {
    completionRateBefore: Number.isFinite(completionRateBefore)
      ? completionRateBefore
      : null,
    missedTasksBefore: Number.isFinite(missedTasksBefore)
      ? Math.trunc(missedTasksBefore)
      : null,
  };
}

/**
 * Deterministic before/after comparison for a single accepted AgentRun.
 *
 * @param {{ agentRun: object, goal: object | null, tasks: Array<object>, now?: Date }} input
 */
function evaluateAgentOutcome({ agentRun, goal, tasks, now = new Date() }) {
  const runAt = agentRun?.createdAt ? new Date(agentRun.createdAt) : null;
  const elapsedHours = runAt ? hoursSince(runAt, now) : 0;

  if (!runAt || elapsedHours < MIN_EVAL_HOURS) {
    return {
      agentRunId: agentRun?.id ?? null,
      outcomeStatus: OUTCOME_STATUS.INSUFFICIENT_DATA,
      reason: "too_little_time",
      completionRateBefore: null,
      completionRateAfter: null,
      missedTasksBefore: null,
      missedTasksAfter: null,
      effectivenessScore: null,
      shouldPersist: false,
    };
  }

  if (!goal) {
    return {
      agentRunId: agentRun?.id ?? null,
      outcomeStatus: OUTCOME_STATUS.INSUFFICIENT_DATA,
      reason: "goal_missing",
      completionRateBefore: null,
      completionRateAfter: null,
      missedTasksBefore: null,
      missedTasksAfter: null,
      effectivenessScore: null,
      shouldPersist: true,
    };
  }

  const { completionRateBefore, missedTasksBefore } = readBeforeMetrics(agentRun);
  if (completionRateBefore == null || missedTasksBefore == null) {
    return {
      agentRunId: agentRun?.id ?? null,
      outcomeStatus: OUTCOME_STATUS.INSUFFICIENT_DATA,
      reason: "missing_before_metrics",
      completionRateBefore,
      completionRateAfter: null,
      missedTasksBefore,
      missedTasksAfter: null,
      effectivenessScore: null,
      shouldPersist: true,
    };
  }

  const current = evaluateGoalProgress({ goal, tasks: tasks || [], now });
  const completionRateAfter = current.completionRate;
  const missedTasksAfter = current.missedTasks;

  const completionDelta = completionRateAfter - completionRateBefore;
  const missedDelta = missedTasksAfter - missedTasksBefore;

  const effectivenessScore = round4(
    completionDelta * 100 - Math.max(0, missedDelta) * 2
  );

  let outcomeStatus = OUTCOME_STATUS.NEUTRAL;
  if (
    completionDelta >= COMPLETION_IMPROVE_THRESHOLD &&
    missedDelta <= 0
  ) {
    outcomeStatus = OUTCOME_STATUS.IMPROVED;
  } else if (
    completionDelta <= COMPLETION_WORSEN_THRESHOLD ||
    missedDelta > 0
  ) {
    outcomeStatus = OUTCOME_STATUS.WORSENED;
  }

  return {
    agentRunId: agentRun.id,
    outcomeStatus,
    reason: null,
    completionRateBefore: round4(completionRateBefore),
    completionRateAfter: round4(completionRateAfter),
    missedTasksBefore,
    missedTasksAfter,
    effectivenessScore,
    completionDelta: round4(completionDelta),
    missedDelta,
    shouldPersist: true,
  };
}

function emptySummary() {
  return {
    evaluatedCount: 0,
    improvedCount: 0,
    neutralCount: 0,
    worsenedCount: 0,
    insufficientDataCount: 0,
    pendingCount: 0,
    results: [],
  };
}

/**
 * Evaluate unchecked accepted AgentRuns for a user and persist outcomes.
 *
 * @param {string} userId
 * @param {{ lookbackDays?: number, now?: Date }} [opts]
 */
async function evaluateOutcomesForUser(
  userId,
  { lookbackDays = 30, now = new Date() } = {}
) {
  const days = Math.min(366, Math.max(7, Number(lookbackDays) || 30));
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const runs = await prisma.agentRun.findMany({
    where: {
      userId,
      acceptedByUser: true,
      createdAt: { gte: start, lte: now },
      outcomeCheckedAt: null,
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      goalId: true,
      userId: true,
      evaluation: true,
      nextAction: true,
      createdAt: true,
      acceptedByUser: true,
    },
  });

  if (runs.length === 0) {
    return emptySummary();
  }

  const goalIds = [...new Set(runs.map((r) => r.goalId))];
  const [goals, allTasks] = await Promise.all([
    prisma.goal.findMany({
      where: { userId, id: { in: goalIds } },
      select: GOAL_SELECT,
    }),
    prisma.task.findMany({
      where: { userId, goalId: { in: goalIds } },
      select: TASK_SELECT,
    }),
  ]);

  const goalById = new Map(goals.map((g) => [g.id, g]));
  const tasksByGoal = new Map();
  for (const task of allTasks) {
    if (!tasksByGoal.has(task.goalId)) tasksByGoal.set(task.goalId, []);
    tasksByGoal.get(task.goalId).push(task);
  }

  const summary = emptySummary();

  for (const run of runs) {
    const goal = goalById.get(run.goalId) || null;
    const tasks = tasksByGoal.get(run.goalId) || [];
    const outcome = evaluateAgentOutcome({
      agentRun: run,
      goal,
      tasks,
      now,
    });

    if (!outcome.shouldPersist) {
      summary.pendingCount += 1;
      summary.insufficientDataCount += 1;
      summary.results.push({
        agentRunId: run.id,
        goalId: run.goalId,
        outcomeStatus: outcome.outcomeStatus,
        reason: outcome.reason,
        persisted: false,
      });
      continue;
    }

    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        outcomeCheckedAt: now,
        completionRateBefore: outcome.completionRateBefore,
        completionRateAfter: outcome.completionRateAfter,
        missedTasksBefore: outcome.missedTasksBefore,
        missedTasksAfter: outcome.missedTasksAfter,
        effectivenessScore: outcome.effectivenessScore,
        outcomeStatus: outcome.outcomeStatus,
      },
    });

    summary.evaluatedCount += 1;
    if (outcome.outcomeStatus === OUTCOME_STATUS.IMPROVED) {
      summary.improvedCount += 1;
    } else if (outcome.outcomeStatus === OUTCOME_STATUS.NEUTRAL) {
      summary.neutralCount += 1;
    } else if (outcome.outcomeStatus === OUTCOME_STATUS.WORSENED) {
      summary.worsenedCount += 1;
    } else if (outcome.outcomeStatus === OUTCOME_STATUS.INSUFFICIENT_DATA) {
      summary.insufficientDataCount += 1;
    }

    summary.results.push({
      agentRunId: run.id,
      goalId: run.goalId,
      nextAction: run.nextAction,
      outcomeStatus: outcome.outcomeStatus,
      completionRateBefore: outcome.completionRateBefore,
      completionRateAfter: outcome.completionRateAfter,
      missedTasksBefore: outcome.missedTasksBefore,
      missedTasksAfter: outcome.missedTasksAfter,
      effectivenessScore: outcome.effectivenessScore,
      persisted: true,
    });
  }

  return summary;
}

module.exports = {
  OUTCOME_STATUS,
  MIN_EVAL_HOURS,
  evaluateAgentOutcome,
  evaluateOutcomesForUser,
};
