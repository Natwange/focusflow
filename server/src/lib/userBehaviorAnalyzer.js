/**
 * Pure behavioral signal extraction (no DB, no LLM, no recommendations).
 */

const DAY_CODES = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const WEEKEND = new Set(["SAT", "SUN"]);
const WEEKDAY = new Set(["MON", "TUE", "WED", "THU", "FRI"]);

const MIN_DATA_POINTS = 8;
const MIN_ACTIVE_DAYS = 4;

function parseDate(value) {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseTzOffsetMinutes(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < -840 || n > 840) return 0;
  return n;
}

function localDateKey(date, tzOffsetMinutes) {
  const tz = parseTzOffsetMinutes(tzOffsetMinutes);
  const localMs = date.getTime() - tz * 60 * 1000;
  const d = new Date(localMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function localWeekdayIndexMonday0(date, tzOffsetMinutes) {
  const tz = parseTzOffsetMinutes(tzOffsetMinutes);
  const localMs = date.getTime() - tz * 60 * 1000;
  const dow = new Date(localMs).getUTCDay();
  return dow === 0 ? 6 : dow - 1;
}

function startOfLocalDay(date, tzOffsetMinutes) {
  const key = localDateKey(date, tzOffsetMinutes);
  const [y, m, d] = key.split("-").map(Number);
  const startUtcMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0) + parseTzOffsetMinutes(tzOffsetMinutes) * 60 * 1000;
  return new Date(startUtcMs);
}

function isDone(task) {
  return task?.status === "done";
}

function taskActivityDate(task) {
  if (isDone(task)) {
    return parseDate(task.completedAt) || parseDate(task.dueDate);
  }
  return parseDate(task.dueDate);
}

function focusSessionDate(session) {
  return (
    parseDate(session?.startedAt) ||
    parseDate(session?.startTime) ||
    parseDate(session?.createdAt)
  );
}

function focusMinutes(session) {
  const n = Number(session?.duration);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function emptyDayStats() {
  return DAY_CODES.map((day) => ({
    day,
    completedTasks: 0,
    missedTasks: 0,
    completionRate: 0,
    focusMinutes: 0,
    focusSessions: 0,
  }));
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.floor((sorted.length - 1) * p);
  return sorted[Math.max(0, idx)];
}

function rankDays(dayOfWeekStats) {
  const scored = dayOfWeekStats.map((row, index) => {
    const hasActivity = row.completedTasks > 0 || row.focusSessions > 0 || row.missedTasks > 0;
    const focusNorm = row.focusMinutes > 0 ? row.focusMinutes : 0;
    const score = hasActivity ? row.completionRate * 0.55 + focusNorm * 0.0005 + row.completedTasks * 0.05 : -1;
    return { index, score, row };
  });
  const active = scored.filter((s) => s.score >= 0);
  active.sort((a, b) => b.score - a.score || a.index - b.index);
  const strongest = active.slice(0, 2).map((s) => s.row.day);
  const weakScored = dayOfWeekStats.map((row, index) => {
    const hasActivity = row.completedTasks > 0 || row.focusSessions > 0 || row.missedTasks > 0;
    const score = hasActivity
      ? row.missedTasks * 0.2 + (1 - row.completionRate) * 0.5 + (row.focusSessions === 0 ? 0.15 : 0)
      : -1;
    return { index, score, row };
  });
  const weakActive = weakScored.filter((s) => s.score >= 0);
  weakActive.sort((a, b) => b.score - a.score || a.index - b.index);
  const weakest = weakActive.slice(0, 2).map((s) => s.row.day);
  return { strongest, weakest };
}

function buildSummary({
  lookbackDays,
  completedTasks,
  missedTasks,
  totalFocusMinutes,
  dayOfWeekStats,
  dataQuality,
}) {
  const total = completedTasks + missedTasks;
  const rate =
    total > 0 ? `${Math.round((completedTasks / total) * 100)}% completion` : "no task outcomes recorded";
  const focusPart =
    totalFocusMinutes > 0
      ? `${totalFocusMinutes} focus minutes logged`
      : "no focus sessions logged";

  if (!dataQuality.hasEnoughData) {
    return `${lookbackDays}-day window: insufficient activity history (${total} task outcomes, ${focusPart}).`;
  }

  const top = [...dayOfWeekStats]
    .filter((r) => r.completedTasks > 0 || r.focusMinutes > 0)
    .sort((a, b) => b.completedTasks - a.completedTasks || b.focusMinutes - a.focusMinutes)
    .slice(0, 2)
    .map((r) => `${r.day}: ${r.completedTasks} completed, ${r.focusMinutes} focus min`)
    .join("; ");

  return `${lookbackDays}-day window: ${completedTasks} tasks completed, ${missedTasks} missed (${rate}); ${focusPart}.${top ? ` Notable days: ${top}.` : ""}`;
}

/**
 * @param {{
 *   tasks?: Array<object>,
 *   focusSessions?: Array<object>,
 *   goals?: Array<object>,
 *   agentRuns?: Array<object>,
 *   now?: Date,
 *   tzOffsetMinutes?: number,
 *   lookbackDays?: number,
 * }} input
 */
function analyzeUserBehavior({
  tasks = [],
  focusSessions = [],
  goals = [],
  agentRuns = [],
  now = new Date(),
  tzOffsetMinutes = 0,
  lookbackDays = 30,
} = {}) {
  const tz = parseTzOffsetMinutes(tzOffsetMinutes);
  const safeLookback = Math.min(366, Math.max(1, Number(lookbackDays) || 30));
  const nowDay = startOfLocalDay(now, tz);
  const windowStartMs = nowDay.getTime() - safeLookback * 24 * 60 * 60 * 1000;

  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const safeFocus = Array.isArray(focusSessions) ? focusSessions : [];
  const safeGoals = Array.isArray(goals) ? goals : [];
  const safeRuns = Array.isArray(agentRuns) ? agentRuns : [];

  const dayOfWeekStats = emptyDayStats();
  const completedPerDay = new Map();
  const activeDateKeys = new Set();

  let totalCompleted = 0;
  let totalMissed = 0;

  for (const task of safeTasks) {
    const activity = taskActivityDate(task);
    if (!activity || activity.getTime() < windowStartMs) continue;

    const wd = localWeekdayIndexMonday0(activity, tz);
    const row = dayOfWeekStats[wd];
    activeDateKeys.add(localDateKey(activity, tz));

    if (isDone(task)) {
      row.completedTasks += 1;
      totalCompleted += 1;
      const dayKey = localDateKey(parseDate(task.completedAt) || activity, tz);
      completedPerDay.set(dayKey, (completedPerDay.get(dayKey) || 0) + 1);
    }

    const due = parseDate(task.dueDate);
    if (!isDone(task) && due && startOfLocalDay(due, tz).getTime() < nowDay.getTime()) {
      const mwd = localWeekdayIndexMonday0(due, tz);
      dayOfWeekStats[mwd].missedTasks += 1;
      totalMissed += 1;
      activeDateKeys.add(localDateKey(due, tz));
    }
  }

  for (const session of safeFocus) {
    const day = focusSessionDate(session);
    if (!day || day.getTime() < windowStartMs) continue;
    const wd = localWeekdayIndexMonday0(day, tz);
    dayOfWeekStats[wd].focusSessions += 1;
    dayOfWeekStats[wd].focusMinutes += focusMinutes(session);
    activeDateKeys.add(localDateKey(day, tz));
  }

  for (const run of safeRuns) {
    const created = parseDate(run?.createdAt);
    if (created && created.getTime() >= windowStartMs) {
      activeDateKeys.add(localDateKey(created, tz));
    }
  }

  for (const row of dayOfWeekStats) {
    const denom = row.completedTasks + row.missedTasks;
    row.completionRate = denom > 0 ? round4(row.completedTasks / denom) : 0;
  }

  const activeDays = activeDateKeys.size;
  const dataPoints = totalCompleted + totalMissed + safeFocus.length + safeRuns.length;
  const hasEnoughData =
    dataPoints >= MIN_DATA_POINTS && activeDays >= MIN_ACTIVE_DAYS;
  const pointScore = Math.min(1, dataPoints / 25);
  const dayScore = Math.min(1, activeDays / Math.min(safeLookback, 14));
  const confidence = hasEnoughData
    ? round4(0.6 * pointScore + 0.4 * dayScore)
    : round4(Math.min(0.35, pointScore * 0.35));

  const completedPerDayValues = [...completedPerDay.values()].sort((a, b) => a - b);
  const averageTasksCompletedPerDay =
    activeDays > 0 ? round4(totalCompleted / activeDays) : 0;
  const averageMissedTasksPerDay =
    activeDays > 0 ? round4(totalMissed / activeDays) : 0;

  const preferredWorkloadRange = {
    min: completedPerDayValues.length > 0 ? percentile(completedPerDayValues, 0.25) : 0,
    max: completedPerDayValues.length > 0 ? percentile(completedPerDayValues, 0.75) : 0,
  };

  const totalFocusMinutes = safeFocus.reduce((s, x) => s + focusMinutes(x), 0);
  const focusActiveDays = new Set(
    safeFocus
      .map((s) => focusSessionDate(s))
      .filter(Boolean)
      .map((d) => localDateKey(d, tz))
  ).size;
  const averageFocusMinutes =
    focusActiveDays > 0 ? round4(totalFocusMinutes / focusActiveDays) : 0;

  const { strongest, weakest } = hasEnoughData
    ? rankDays(dayOfWeekStats)
    : { strongest: [], weakest: [] };

  let bestFocusDays = [];
  let weakestFocusDays = [];
  if (hasEnoughData) {
    const byFocus = [...dayOfWeekStats]
      .filter((r) => r.focusSessions > 0)
      .sort((a, b) => b.focusMinutes - a.focusMinutes);
    bestFocusDays = byFocus.slice(0, 2).map((r) => r.day);
    weakestFocusDays = [...byFocus].reverse().slice(0, 2).map((r) => r.day);
  }

  function aggregateDays(filter) {
    return dayOfWeekStats.filter((r) => filter.has(r.day));
  }

  const weekendRows = aggregateDays(WEEKEND);
  const weekdayRows = aggregateDays(WEEKDAY);

  function sumField(rows, field) {
    return rows.reduce((s, r) => s + r[field], 0);
  }

  function completionRateForRows(rows) {
    const completed = sumField(rows, "completedTasks");
    const missed = sumField(rows, "missedTasks");
    const denom = completed + missed;
    return denom > 0 ? round4(completed / denom) : 0;
  }

  const weekendVsWeekdayComparison = {
    weekendCompletionRate: completionRateForRows(weekendRows),
    weekdayCompletionRate: completionRateForRows(weekdayRows),
    weekendFocusMinutes: sumField(weekendRows, "focusMinutes"),
    weekdayFocusMinutes: sumField(weekdayRows, "focusMinutes"),
    weekendTasksCompleted: sumField(weekendRows, "completedTasks"),
    weekdayTasksCompleted: sumField(weekdayRows, "completedTasks"),
  };

  let workloadTolerance = "unknown";
  if (hasEnoughData) {
    if (averageTasksCompletedPerDay < 1.5) workloadTolerance = "low";
    else if (averageTasksCompletedPerDay <= 3) workloadTolerance = "moderate";
    else workloadTolerance = "high";
  }

  const consistencyScore = round4(activeDays / safeLookback);
  const recoveryDenom = totalCompleted + totalMissed;
  const recoveryScore =
    recoveryDenom > 0 ? round4(totalCompleted / recoveryDenom) : 0;

  const dataQuality = { hasEnoughData, confidence };

  const summary = buildSummary({
    lookbackDays: safeLookback,
    completedTasks: totalCompleted,
    missedTasks: totalMissed,
    totalFocusMinutes,
    dayOfWeekStats,
    dataQuality,
  });

  return {
    dayOfWeekStats,
    workloadPatterns: {
      averageTasksCompletedPerDay,
      averageMissedTasksPerDay,
      preferredWorkloadRange,
    },
    focusPatterns: {
      averageFocusMinutes,
      bestFocusDays,
      weakestFocusDays,
    },
    productivityPatterns: {
      strongestDays: strongest,
      weakestDays: weakest,
      weekendVsWeekdayComparison,
    },
    planningSignals: {
      workloadTolerance,
      consistencyScore,
      recoveryScore,
    },
    dataQuality,
    meta: {
      lookbackDays: safeLookback,
      activeDays,
      dataPoints,
      goalCount: safeGoals.length,
      agentRunCount: safeRuns.length,
    },
    summary,
  };
}

module.exports = {
  analyzeUserBehavior,
  DAY_CODES,
  MIN_DATA_POINTS,
  MIN_ACTIVE_DAYS,
};
