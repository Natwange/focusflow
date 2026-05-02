/**
 * Pure, deterministic user activity pattern analysis (no DB, no LLM).
 * All inputs optional; missing collections are treated as empty.
 */

const WEEKDAY_ORDER = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

/** 0 = Monday … 6 = Sunday (UTC) */
function utcWeekdayIndexMonday0(date) {
  const dow = date.getUTCDay(); // 0 Sun … 6 Sat
  return dow === 0 ? 6 : dow - 1;
}

function parseDate(value) {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDayUtc(d) {
  const x = parseDate(d);
  if (!x) return null;
  const out = new Date(x);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

function isDone(task) {
  return task?.status === "done";
}

/** Weekday bucket for task activity (UTC): completion day if done, else due day. */
function taskBucketDate(task) {
  if (isDone(task)) {
    const c = parseDate(task.completedAt);
    if (c) return c;
    return parseDate(task.dueDate);
  }
  return parseDate(task.dueDate);
}

function focusSessionDay(session) {
  const t =
    parseDate(session?.startedAt) ||
    parseDate(session?.startTime) ||
    parseDate(session?.createdAt);
  return t;
}

function focusMinutes(session) {
  const n = Number(session?.duration);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function emptyWeekdayStats() {
  return WEEKDAY_ORDER.map((weekday) => ({
    weekday,
    totalTasks: 0,
    completedTasks: 0,
    missedTasks: 0,
    completionRate: 0,
    focusSessions: 0,
    focusMinutes: 0,
    goalsTouched: 0,
    agentRecommendationsAccepted: 0,
  }));
}

function analyzeUserActivityPatterns({
  tasks = [],
  focusSessions = [],
  goals = [],
  agentRuns = [],
  streaks = null,
  now = new Date(),
} = {}) {
  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const safeFocus = Array.isArray(focusSessions) ? focusSessions : [];
  const safeGoals = Array.isArray(goals) ? goals : [];
  const safeRuns = Array.isArray(agentRuns) ? agentRuns : [];

  const nowDay = startOfDayUtc(now);
  if (!nowDay) {
    return buildEmptyResult("Invalid reference time; cannot analyze.");
  }

  const weekdayStats = emptyWeekdayStats();
  const goalsTouchedByWd = WEEKDAY_ORDER.map(() => new Set());

  for (const task of safeTasks) {
    const bucket = taskBucketDate(task);
    if (!bucket) continue;
    const wd = utcWeekdayIndexMonday0(bucket);
    const row = weekdayStats[wd];
    row.totalTasks += 1;
    if (isDone(task)) {
      row.completedTasks += 1;
    }
    const due = parseDate(task.dueDate);
    if (!isDone(task) && due && startOfDayUtc(due).getTime() < nowDay.getTime()) {
      const mwd = utcWeekdayIndexMonday0(due);
      weekdayStats[mwd].missedTasks += 1;
    }
    if (task?.goalId) {
      goalsTouchedByWd[wd].add(String(task.goalId));
    }
  }

  for (let w = 0; w < 7; w++) {
    weekdayStats[w].goalsTouched = goalsTouchedByWd[w].size;
    const t = weekdayStats[w].totalTasks;
    weekdayStats[w].completionRate =
      t > 0 ? Math.round((weekdayStats[w].completedTasks / t) * 10000) / 10000 : 0;
  }

  for (const session of safeFocus) {
    const day = focusSessionDay(session);
    if (!day) continue;
    const wd = utcWeekdayIndexMonday0(day);
    weekdayStats[wd].focusSessions += 1;
    weekdayStats[wd].focusMinutes += focusMinutes(session);
  }

  for (const run of safeRuns) {
    const c = parseDate(run?.createdAt);
    if (!c) continue;
    const wd = utcWeekdayIndexMonday0(c);
    if (run?.acceptedByUser === true) {
      weekdayStats[wd].agentRecommendationsAccepted += 1;
    }
  }

  const totalTasks = safeTasks.length;
  const completedTasks = safeTasks.filter(isDone).length;
  const missedTasks = safeTasks.filter((t) => {
    if (isDone(t)) return false;
    const due = parseDate(t?.dueDate);
    if (!due) return false;
    return startOfDayUtc(due).getTime() < nowDay.getTime();
  }).length;
  const completionRate =
    totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 10000) / 10000 : 0;

  const totalFocusMinutes = safeFocus.reduce((s, x) => s + focusMinutes(x), 0);
  const focusDays = new Set();
  for (const session of safeFocus) {
    const day = focusSessionDay(session);
    if (day) {
      const key = day.toISOString().slice(0, 10);
      focusDays.add(key);
    }
  }
  const daysWithFocus = focusDays.size;
  const averageFocusMinutesPerActiveDay =
    daysWithFocus > 0
      ? Math.round((totalFocusMinutes / daysWithFocus) * 100) / 100
      : 0;

  let maxFm = 0;
  for (const row of weekdayStats) {
    if (row.focusMinutes > maxFm) maxFm = row.focusMinutes;
  }

  const strengthScores = weekdayStats.map((row, i) => {
    const normFocus = maxFm > 0 ? row.focusMinutes / maxFm : 0;
    const hasAny = row.totalTasks > 0 || row.focusSessions > 0;
    const score = hasAny ? 0.5 * row.completionRate + 0.5 * normFocus : -1;
    return { i, score, row };
  });

  const weakScores = weekdayStats.map((row, i) => {
    const normFocus = maxFm > 0 ? row.focusMinutes / maxFm : 0;
    const hasAny = row.totalTasks > 0 || row.focusSessions > 0;
    const missWeight = row.missedTasks * 0.15;
    const lowComp = row.totalTasks > 0 ? 1 - row.completionRate : 0;
    const lowFocus = 1 - normFocus;
    const score = hasAny ? missWeight + 0.45 * lowComp + 0.4 * lowFocus : -1;
    return { i, score, row };
  });

  const dataPoints =
    safeTasks.filter((t) => taskBucketDate(t) != null).length + safeFocus.length;
  const lowData = dataPoints < 5 && safeRuns.length < 3;

  let bestDays = [];
  let weakDays = [];
  if (!lowData) {
    const candidates = strengthScores.filter((s) => s.score >= 0);
    candidates.sort((a, b) => b.score - a.score || a.i - b.i);
    bestDays = candidates.slice(0, 2).map((s) => WEEKDAY_ORDER[s.i]);

    const weakCand = weakScores.filter((s) => s.score >= 0);
    weakCand.sort((a, b) => b.score - a.score || a.i - b.i);
    weakDays = weakCand.slice(0, 2).map((s) => WEEKDAY_ORDER[s.i]);
  }

  const activeDateKeys = new Set();
  for (const task of safeTasks) {
    const a = taskBucketDate(task);
    if (a) activeDateKeys.add(a.toISOString().slice(0, 10));
    const due = parseDate(task?.dueDate);
    if (due) activeDateKeys.add(due.toISOString().slice(0, 10));
  }
  for (const session of safeFocus) {
    const d = focusSessionDay(session);
    if (d) activeDateKeys.add(d.toISOString().slice(0, 10));
  }
  for (const run of safeRuns) {
    const c = parseDate(run?.createdAt);
    if (c) activeDateKeys.add(c.toISOString().slice(0, 10));
  }

  const windowEnd = nowDay.getTime();
  const windowStart = windowEnd - 90 * 24 * 60 * 60 * 1000;
  let inactiveDays = 0;
  for (let t = windowStart; t < windowEnd; t += 24 * 60 * 60 * 1000) {
    const key = new Date(t).toISOString().slice(0, 10);
    if (!activeDateKeys.has(key)) inactiveDays += 1;
  }

  let currentStreak = 0;
  let longestStreak = 0;
  if (streaks && typeof streaks === "object") {
    if (Number.isFinite(streaks.currentStreak)) currentStreak = Math.max(0, streaks.currentStreak);
    if (Number.isFinite(streaks.longestStreak)) longestStreak = Math.max(0, streaks.longestStreak);
    if (currentStreak === 0 && Number.isFinite(streaks.streakCount)) {
      currentStreak = Math.max(0, streaks.streakCount);
    }
  }
  if (longestStreak === 0 && currentStreak > 0) longestStreak = currentStreak;

  const sortedKeys = [...activeDateKeys].sort();
  if (sortedKeys.length > 0) {
    let run = 1;
    let best = 1;
    for (let i = 1; i < sortedKeys.length; i++) {
      const prev = new Date(`${sortedKeys[i - 1]}T00:00:00.000Z`).getTime();
      const cur = new Date(`${sortedKeys[i]}T00:00:00.000Z`).getTime();
      if (cur - prev === 24 * 60 * 60 * 1000) {
        run += 1;
        if (run > best) best = run;
      } else {
        run = 1;
      }
    }
    longestStreak = Math.max(longestStreak, best);
  }

  const totalRecommendations = safeRuns.length;
  const acceptedRecommendations = safeRuns.filter((r) => r?.acceptedByUser === true).length;
  const acceptanceRate =
    totalRecommendations > 0
      ? Math.round((acceptedRecommendations / totalRecommendations) * 10000) / 10000
      : 0;

  let bestFocusDay = null;
  let weakestFocusDay = null;
  let maxF = -1;
  let minF = Infinity;
  for (const row of weekdayStats) {
    if (row.focusMinutes > maxF) {
      maxF = row.focusMinutes;
      bestFocusDay = row.weekday;
    }
    if (row.focusSessions > 0 && row.focusMinutes < minF) {
      minF = row.focusMinutes;
      weakestFocusDay = row.weekday;
    }
  }
  if (maxF <= 0) bestFocusDay = null;
  if (!Number.isFinite(minF) || safeFocus.length === 0) weakestFocusDay = null;

  const summary = lowData
    ? `Limited activity data (${dataPoints} dated events in sample). Patterns are preliminary.`
    : `Analyzed ${safeTasks.length} tasks, ${safeFocus.length} focus sessions, ${safeGoals.length} goals, ${safeRuns.length} agent runs over a 90-day UTC window for inactivity.`;

  return {
    lowData,
    weekdayStats,
    bestDays,
    weakDays,
    consistencySignals: {
      currentStreak,
      longestStreak,
      activeDays: activeDateKeys.size,
      inactiveDays,
    },
    focusSignals: {
      totalFocusMinutes,
      averageFocusMinutesPerActiveDay,
      bestFocusDay,
      weakestFocusDay,
    },
    taskSignals: {
      totalTasks,
      completedTasks,
      missedTasks,
      completionRate,
    },
    agentSignals: {
      totalRecommendations,
      acceptedRecommendations,
      acceptanceRate,
    },
    summary,
  };
}

function buildEmptyResult(summary) {
  return {
    lowData: true,
    weekdayStats: emptyWeekdayStats(),
    bestDays: [],
    weakDays: [],
    consistencySignals: {
      currentStreak: 0,
      longestStreak: 0,
      activeDays: 0,
      inactiveDays: 0,
    },
    focusSignals: {
      totalFocusMinutes: 0,
      averageFocusMinutesPerActiveDay: 0,
      bestFocusDay: null,
      weakestFocusDay: null,
    },
    taskSignals: {
      totalTasks: 0,
      completedTasks: 0,
      missedTasks: 0,
      completionRate: 0,
    },
    agentSignals: {
      totalRecommendations: 0,
      acceptedRecommendations: 0,
      acceptanceRate: 0,
    },
    summary,
  };
}

module.exports = {
  analyzeUserActivityPatterns,
  WEEKDAY_ORDER,
};
