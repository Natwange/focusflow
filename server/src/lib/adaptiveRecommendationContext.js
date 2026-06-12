const prisma = require("./prisma");
const { runGoalAgent } = require("./goalAgentOrchestrator");
const { getAgentStrategyStatsForUser } = require("./agentStrategyStats");
const { analyzeUserBehavior } = require("./userBehaviorAnalyzer");
const { loadUserBehaviorData } = require("./userBehaviorContext");
const {
  deriveCandidateActions,
  rankAdaptiveRecommendations,
} = require("./adaptiveRecommendationRanker");

const GOAL_SELECT = {
  id: true,
  userId: true,
  title: true,
  totalUnits: true,
  unitName: true,
  createdAt: true,
  deadline: true,
  availableDays: true,
  maxUnitsPerDay: true,
};

const TASK_SELECT = {
  id: true,
  title: true,
  status: true,
  dueDate: true,
  unitStart: true,
  unitEnd: true,
};

async function requireOwnedGoal(userId, goalId) {
  const goal = await prisma.goal.findUnique({
    where: { id: goalId },
    select: GOAL_SELECT,
  });
  if (!goal) {
    const err = new Error("Goal not found.");
    err.code = "NOT_FOUND";
    throw err;
  }
  if (String(goal.userId) !== String(userId)) {
    const err = new Error("Goal does not belong to you.");
    err.code = "FORBIDDEN";
    throw err;
  }
  return goal;
}

async function loadGoalTasks(userId, goalId) {
  return prisma.task.findMany({
    where: { userId, goalId },
    select: TASK_SELECT,
  });
}

/**
 * @param {string} userId
 * @param {{ tzOffsetMinutes?: number, lookbackDays?: number, now?: Date }} [opts]
 */
async function loadAdaptiveRankingInputs(
  userId,
  { tzOffsetMinutes = 0, lookbackDays = 30, now = new Date() } = {}
) {
  const [strategyStats, behaviorBundle] = await Promise.all([
    getAgentStrategyStatsForUser(userId, { now }),
    loadUserBehaviorData(userId, { lookbackDays, now }),
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

  return { strategyStats, behavior };
}

/**
 * Pure assembly for tests and callers that already have agent outputs.
 */
function buildAdaptiveRanking({
  agentResult,
  strategyStats,
  behavior,
  candidateActions,
}) {
  const actions =
    candidateActions ||
    deriveCandidateActions({
      failureAnalysis: agentResult?.failureAnalysis,
      rebalanceRecommendation: agentResult?.rebalanceRecommendation,
      goalEvaluation: agentResult?.evaluation,
    });

  return rankAdaptiveRecommendations({
    candidateActions: actions,
    strategyStats,
    behaviorContext: behavior,
    goalEvaluation: agentResult?.evaluation,
    failureAnalysis: agentResult?.failureAnalysis,
    rebalanceRecommendation: agentResult?.rebalanceRecommendation,
  });
}

function urgencyScore(evaluation, goal) {
  let score = 0;
  if (evaluation?.behindSchedule) score += 50;
  if (evaluation?.status === "at_risk") score += 30;
  else if (evaluation?.status === "slightly_behind") score += 15;
  if (goal?.deadline) {
    const days =
      (new Date(goal.deadline).getTime() - Date.now()) /
      (24 * 60 * 60 * 1000);
    if (days < 0) score += 40;
    else if (days <= 7) score += 20;
  }
  return score;
}

/**
 * @param {string} userId
 * @param {{ goalId?: string, tzOffsetMinutes?: number, lookbackDays?: number }} [opts]
 */
async function getAdaptiveRecommendationForUser(
  userId,
  { goalId, tzOffsetMinutes = 0, lookbackDays = 30, now = new Date() } = {}
) {
  const { strategyStats, behavior } = await loadAdaptiveRankingInputs(userId, {
    tzOffsetMinutes,
    lookbackDays,
    now,
  });

  let goal;
  let tasks;
  let agentResult;

  if (goalId) {
    goal = await requireOwnedGoal(userId, goalId);
    tasks = await loadGoalTasks(userId, goalId);
    agentResult = runGoalAgent({ goal, tasks, now });
  } else {
    const goals = await prisma.goal.findMany({
      where: { userId },
      select: {
        id: true,
        title: true,
        deadline: true,
        availableDays: true,
        maxUnitsPerDay: true,
        totalUnits: true,
        unitName: true,
        userId: true,
        createdAt: true,
      },
      take: 100,
    });

    if (goals.length === 0) {
      return {
        goalId: null,
        goalTitle: null,
        evaluation: null,
        failureAnalysis: null,
        rebalanceRecommendation: null,
        adaptiveRanking: rankAdaptiveRecommendations({
          candidateActions: ["manual_review", "focus_session"],
          strategyStats,
          behaviorContext: behavior,
          goalEvaluation: {},
          failureAnalysis: { failureModes: ["no_failure_detected"] },
          rebalanceRecommendation: {
            canRebalance: false,
            recommendedAction: "manual_review",
          },
        }),
        strategyStats,
        behavior,
      };
    }

    const allTasks = await prisma.task.findMany({
      where: { userId, goalId: { in: goals.map((g) => g.id) } },
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
    });

    let best = null;
    let bestScore = -1;

    for (const g of goals) {
      const goalTasks = allTasks.filter((t) => t.goalId === g.id);
      const result = runGoalAgent({ goal: g, tasks: goalTasks, now });
      const score = urgencyScore(result.evaluation, g);
      if (score > bestScore) {
        bestScore = score;
        best = { goal: g, tasks: goalTasks, agentResult: result };
      }
    }

    goal = best.goal;
    tasks = best.tasks;
    agentResult = best.agentResult;
  }

  const adaptiveRanking = buildAdaptiveRanking({
    agentResult,
    strategyStats,
    behavior,
  });

  return {
    goalId: goal.id,
    goalTitle: goal.title,
    evaluation: agentResult.evaluation,
    failureAnalysis: agentResult.failureAnalysis,
    rebalanceRecommendation: agentResult.rebalanceRecommendation,
    adaptiveRanking,
    strategyStats,
    behavior,
  };
}

module.exports = {
  loadAdaptiveRankingInputs,
  buildAdaptiveRanking,
  getAdaptiveRecommendationForUser,
};
