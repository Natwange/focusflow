/**
 * Productivity score — pure helpers for mock UI today, API/business logic later.
 * Adjust targets and weights here; the UI should only call the exported functions.
 */

export type AnalyticsInterval = "day" | "week" | "month";

/** Raw inputs for one period (e.g. this week). Same shape a future API can return. */
export type ProductivityPeriodMetrics = {
  tasksCompleted: number;
  tasksPlanned: number;
  focusMinutes: number;
  avgSessionMinutes: number;
  streakDays: number;
};

export type ProductivityScoreResult = {
  /** 0–100 overall score */
  score: number;
  /** How strongly each pillar contributed (each 0–100 before weighting) */
  pillars: {
    tasks: number;
    focus: number;
    completion: number;
  };
};

export type ProductivityScoreComparison = {
  currentScore: number;
  previousScore: number;
  /** Current minus previous (whole points) */
  scoreDelta: number;
  currentBreakdown: ProductivityScoreResult;
  previousBreakdown: ProductivityScoreResult;
};

// --- Tunable constants (replace with server config later if needed) ---

/** “Full marks” for focus minutes per interval — values at or above = 100% on that pillar */
const FOCUS_MINUTES_TARGET: Record<AnalyticsInterval, number> = {
  day: 120,
  week: 1800,
  month: 7200,
};

/** “Full marks” for tasks completed in the period */
const TASKS_COMPLETED_TARGET: Record<AnalyticsInterval, number> = {
  day: 10,
  week: 40,
  month: 140,
};

const PILLAR_WEIGHTS = {
  tasks: 1 / 3,
  focus: 1 / 3,
  completion: 1 / 3,
} as const;

// --- Small utilities ---

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Maps actual / target to 0–100, capped at 100 when you beat the target */
export function normalizeToPercent(actual: number, target: number): number {
  if (target <= 0) return 0;
  return clamp01(actual / target) * 100;
}

/** Share of planned tasks you finished (0–1). */
export function tasksCompletionRate(m: ProductivityPeriodMetrics): number {
  if (m.tasksPlanned <= 0) return 0;
  return clamp01(m.tasksCompleted / m.tasksPlanned);
}

// --- Core score (single place for the formula) ---

/**
 * Overall productivity score from tasks done, focus time, and completion rate.
 * Completion uses tasksCompleted / tasksPlanned when both are set.
 */
export function computeProductivityScore(
  interval: AnalyticsInterval,
  metrics: ProductivityPeriodMetrics
): ProductivityScoreResult {
  const tasksPillar = normalizeToPercent(
    metrics.tasksCompleted,
    TASKS_COMPLETED_TARGET[interval]
  );
  const focusPillar = normalizeToPercent(
    metrics.focusMinutes,
    FOCUS_MINUTES_TARGET[interval]
  );
  const completionPillar = tasksCompletionRate(metrics) * 100;

  const score = Math.round(
    tasksPillar * PILLAR_WEIGHTS.tasks +
      focusPillar * PILLAR_WEIGHTS.focus +
      completionPillar * PILLAR_WEIGHTS.completion
  );

  return {
    score,
    pillars: {
      tasks: Math.round(tasksPillar),
      focus: Math.round(focusPillar),
      completion: Math.round(completionPillar),
    },
  };
}

/** Compare two periods using the same interval rules (e.g. this week vs last week). */
export function compareProductivityScores(
  interval: AnalyticsInterval,
  current: ProductivityPeriodMetrics,
  previous: ProductivityPeriodMetrics
): ProductivityScoreComparison {
  const currentBreakdown = computeProductivityScore(interval, current);
  const previousBreakdown = computeProductivityScore(interval, previous);

  return {
    currentScore: currentBreakdown.score,
    previousScore: previousBreakdown.score,
    scoreDelta: currentBreakdown.score - previousBreakdown.score,
    currentBreakdown,
    previousBreakdown,
  };
}

/** Short, non-technical copy for the hero or score card. */
export function describeScoreChangeVsPrevious(
  scoreDelta: number,
  compareLabel: string
): { headline: string; detail: string } {
  const label = compareLabel.trim();
  if (scoreDelta === 0) {
    return {
      headline: "About the same as last time",
      detail: `Your productivity score ${label}.`,
    };
  }
  if (scoreDelta > 0) {
    return {
      headline: `${scoreDelta} points higher`,
      detail: `Your productivity score ${label}.`,
    };
  }
  return {
    headline: `${Math.abs(scoreDelta)} points lower`,
    detail: `Your productivity score ${label}.`,
  };
}

/** User-facing labels for the three pillars (avoid jargon like “normalized”). */
export const PILLAR_LABELS = {
  tasks: "Tasks done",
  focus: "Focus time",
  completion: "Follow-through",
} as const;
