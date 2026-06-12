const prisma = require("./prisma");
const { OUTCOME_STATUS } = require("./agentOutcomeEvaluator");

const TRACKED_STRATEGIES = [
  "rebalance",
  "extend_deadline",
  "reduce_scope",
  "keep_plan",
];

const MIN_EVALUATED_OUTCOMES = 3;

function round4(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10000) / 10000;
}

function normalizeStrategy(nextAction) {
  const key = String(nextAction || "").trim();
  if (TRACKED_STRATEGIES.includes(key)) return key;
  return null;
}

/**
 * Pure aggregation from AgentRun rows (testable).
 *
 * @param {Array<object>} runs
 * @param {{ lookbackDays?: number }} [opts]
 */
function aggregateStrategyStats(runs, { lookbackDays = 90 } = {}) {
  const buckets = Object.fromEntries(
    TRACKED_STRATEGIES.map((s) => [
      s,
      {
        strategy: s,
        timesSuggested: 0,
        timesAccepted: 0,
        evaluatedOutcomes: 0,
        improvedOutcomes: 0,
        effectivenessScores: [],
      },
    ])
  );

  for (const run of runs) {
    const strategy = normalizeStrategy(run.nextAction);
    if (!strategy) continue;

    const bucket = buckets[strategy];
    bucket.timesSuggested += 1;
    if (run.acceptedByUser) bucket.timesAccepted += 1;

    const status = run.outcomeStatus;
    if (
      run.acceptedByUser &&
      status &&
      status !== OUTCOME_STATUS.INSUFFICIENT_DATA &&
      status !== OUTCOME_STATUS.NOT_CHECKED
    ) {
      bucket.evaluatedOutcomes += 1;
      if (status === OUTCOME_STATUS.IMPROVED) bucket.improvedOutcomes += 1;
      if (Number.isFinite(run.effectivenessScore)) {
        bucket.effectivenessScores.push(run.effectivenessScore);
      }
    }
  }

  const strategyStats = TRACKED_STRATEGIES.map((strategy) => {
    const b = buckets[strategy];
    const avg =
      b.effectivenessScores.length > 0
        ? round4(
            b.effectivenessScores.reduce((s, n) => s + n, 0) /
              b.effectivenessScores.length
          )
        : null;
    const successRate =
      b.evaluatedOutcomes > 0
        ? round4(b.improvedOutcomes / b.evaluatedOutcomes)
        : null;

    return {
      strategy,
      timesSuggested: b.timesSuggested,
      timesAccepted: b.timesAccepted,
      averageEffectivenessScore: avg,
      successRate,
      evaluatedOutcomes: b.evaluatedOutcomes,
    };
  });

  const evaluatedAcceptedCount = strategyStats.reduce(
    (sum, row) => sum + row.evaluatedOutcomes,
    0
  );

  return {
    hasEnoughData: evaluatedAcceptedCount >= MIN_EVALUATED_OUTCOMES,
    evaluatedAcceptedCount,
    minRequired: MIN_EVALUATED_OUTCOMES,
    lookbackDays,
    strategyStats,
  };
}

/**
 * Aggregate accepted/evaluated outcomes by nextAction strategy.
 *
 * @param {string} userId
 * @param {{ lookbackDays?: number, now?: Date }} [opts]
 */
async function getAgentStrategyStatsForUser(
  userId,
  { lookbackDays = 90, now = new Date() } = {}
) {
  const days = Math.min(366, Math.max(7, Number(lookbackDays) || 90));
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const runs = await prisma.agentRun.findMany({
    where: {
      userId,
      createdAt: { gte: start, lte: now },
    },
    select: {
      nextAction: true,
      acceptedByUser: true,
      outcomeStatus: true,
      effectivenessScore: true,
    },
  });

  return aggregateStrategyStats(runs, { lookbackDays: days });
}

module.exports = {
  TRACKED_STRATEGIES,
  MIN_EVALUATED_OUTCOMES,
  aggregateStrategyStats,
  getAgentStrategyStatsForUser,
};
