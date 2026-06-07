const prisma = require("./prisma");
const { analyzeUserBehavior } = require("./userBehaviorAnalyzer");
const { parseTzOffsetMinutes } = require("./focusSummary");

const DEFAULT_LOOKBACK_DAYS = 30;

/**
 * Load scoped activity rows for behavior analysis (same ownership as analytics route).
 */
async function loadUserBehaviorData(userId, { lookbackDays = DEFAULT_LOOKBACK_DAYS, now = new Date() } = {}) {
  const days = Math.min(366, Math.max(7, Number(lookbackDays) || DEFAULT_LOOKBACK_DAYS));
  const startUtc = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const [tasks, focusSessions, goals, agentRuns] = await Promise.all([
    prisma.task.findMany({
      where: {
        userId,
        OR: [
          { dueDate: { gte: startUtc } },
          { completedAt: { gte: startUtc } },
          {
            AND: [
              { status: { not: "done" } },
              { dueDate: { not: null } },
              { dueDate: { lte: now } },
              { dueDate: { gte: startUtc } },
            ],
          },
        ],
      },
      select: {
        id: true,
        status: true,
        dueDate: true,
        completedAt: true,
        goalId: true,
      },
      take: 5000,
    }),
    prisma.focusSession.findMany({
      where: { userId, startedAt: { gte: startUtc, lte: now } },
      select: { duration: true, startedAt: true, createdAt: true },
      take: 10000,
    }),
    prisma.goal.findMany({
      where: { userId },
      select: { id: true, createdAt: true },
      take: 500,
    }),
    prisma.agentRun.findMany({
      where: { userId, createdAt: { gte: startUtc, lte: now } },
      select: { createdAt: true, acceptedByUser: true },
      take: 2000,
    }),
  ]);

  return { tasks, focusSessions, goals, agentRuns, lookbackDays: days };
}

/**
 * Compact signals for Claude — no raw task/session dumps.
 */
function compactBehaviorSignals(analysis) {
  return {
    dayOfWeekStats: analysis.dayOfWeekStats,
    workloadPatterns: analysis.workloadPatterns,
    focusPatterns: analysis.focusPatterns,
    productivityPatterns: analysis.productivityPatterns,
    planningSignals: analysis.planningSignals,
    dataQuality: analysis.dataQuality,
    meta: analysis.meta,
    summary: analysis.summary,
  };
}

/**
 * @param {string} userId
 * @param {{ lookbackDays?: number, tzOffsetMinutes?: number }} [options]
 */
async function getUserBehaviorContextForUser(
  userId,
  { lookbackDays = DEFAULT_LOOKBACK_DAYS, tzOffsetMinutes = 0 } = {}
) {
  const tz = parseTzOffsetMinutes(tzOffsetMinutes);
  const now = new Date();
  const loaded = await loadUserBehaviorData(userId, { lookbackDays, now });

  const analysis = analyzeUserBehavior({
    tasks: loaded.tasks,
    focusSessions: loaded.focusSessions,
    goals: loaded.goals,
    agentRuns: loaded.agentRuns,
    now,
    tzOffsetMinutes: tz,
    lookbackDays: loaded.lookbackDays,
  });

  return {
    lookbackDays: loaded.lookbackDays,
    tzOffsetMinutes: tz,
    generatedAt: now.toISOString(),
    signals: compactBehaviorSignals(analysis),
    summary: analysis.summary,
  };
}

module.exports = {
  getUserBehaviorContextForUser,
  loadUserBehaviorData,
  compactBehaviorSignals,
  DEFAULT_LOOKBACK_DAYS,
};
