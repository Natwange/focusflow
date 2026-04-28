const express = require("express");
const prisma = require("../lib/prisma");

const router = express.Router();

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function localDateKey(d) {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}


// GET /analytics/overview
router.get("/overview", async (req, res) => {
  try {
    const userId = req.user.id;

    const now = new Date();
    const today = startOfDay(now);
    const next7 = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    const prev7 = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

    // 1) Task counts by status
    const [todo, doing, done] = await Promise.all([
      prisma.task.count({ where: { userId, status: "todo" } }),
      prisma.task.count({ where: { userId, status: "doing" } }),
      prisma.task.count({ where: { userId, status: "done" } }),
    ]);

    // 2) Upcoming tasks in next 7 days (not done)
    const upcoming = await prisma.task.findMany({
      where: {
        userId,
        status: { not: "done" },
        dueDate: { gte: today, lt: next7 },
      },
      orderBy: { dueDate: "asc" },
      select: { id: true, title: true, dueDate: true, status: true, goalId: true },
    });

    // 3) Momentum (MVP): days with "done" tasks created in last 7 days
    // NOTE: this is imperfect until we add completedAt. We'll upgrade soon.
    const recentDone = await prisma.task.findMany({
      where: { userId, status: "done", completedAt: { gte: prev7 } },
      select: { completedAt: true },
    });

    const activeDays = new Set(
      recentDone.map((t) => localDateKey(t.completedAt))
    ).size;

    return res.json({
      window: { from: prev7.toISOString(), to: next7.toISOString() },
      tasks: {
        counts: { todo, doing, done },
        upcomingNext7Days: upcoming,
      },
      momentum: { activeDaysLast7: activeDays },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /analytics/productivity?days=14
router.get("/productivity", async (req, res) => {
  try {
    const userId = req.user.id;
    const days = Math.min(Number(req.query.days) || 14, 60);

    const today = startOfDay(new Date());
    const start = new Date(today.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

    const doneTasks = await prisma.task.findMany({
      where: {
        userId,
        status: "done",
        completedAt: { gte: start, lt: tomorrow },
      },
      select: { completedAt: true },
    });

    const counts = new Map();
    for (const t of doneTasks) {
      const day = localDateKey(t.completedAt);
      counts.set(day, (counts.get(day) || 0) + 1);
    }

    const donePerDay = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
      const key = localDateKey(d);
      donePerDay.push({ date: key, doneCount: counts.get(key) || 0 });
    }

    let bestDay = null;
    for (const row of donePerDay) {
      if (row.doneCount === 0) continue;
      if (!bestDay || row.doneCount > bestDay.doneCount) bestDay = row;
    }

    return res.json({
      window: { start: start.toISOString(), days },
      totalDone: doneTasks.length,
      sampleCompletedAts: doneTasks.slice(0, 5).map((t) => t.completedAt),
      bestDay,
      donePerDay,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// --- Timezone-aware helpers (same convention as /focus) ---

function parseTzOffsetMinutes(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < -840 || n > 840) return 0;
  return n;
}

function localKeyFromUtcDate(utcDate, tzOffsetMinutes) {
  const localMs = utcDate.getTime() - tzOffsetMinutes * 60 * 1000;
  const d = new Date(localMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function utcRangeForLocalDateKey(localDateKey, tzOffsetMinutes) {
  const [yStr, mStr, dStr] = String(localDateKey).split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const startUtcMs =
    Date.UTC(y, m - 1, d, 0, 0, 0, 0) + tzOffsetMinutes * 60 * 1000;
  const endUtcMs = startUtcMs + 24 * 60 * 60 * 1000;
  return { startUtc: new Date(startUtcMs), endUtc: new Date(endUtcMs) };
}

function addLocalDays(dateKey, delta) {
  const [y, mo, d] = dateKey.split("-").map(Number);
  const ms = Date.UTC(y, mo - 1, d) + delta * 86400000;
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
    dt.getUTCDate()
  ).padStart(2, "0")}`;
}

function rangeUtc(startKey, endKeyExclusive, tzOffsetMinutes) {
  const a = utcRangeForLocalDateKey(startKey, tzOffsetMinutes);
  const b = utcRangeForLocalDateKey(endKeyExclusive, tzOffsetMinutes);
  if (!a || !b) return null;
  return { startUtc: a.startUtc, endUtc: b.startUtc };
}

async function sumFocusMinutes(userId, startUtc, endUtc) {
  const sessions = await prisma.focusSession.findMany({
    where: { userId, startedAt: { gte: startUtc, lt: endUtc } },
    select: { duration: true },
  });
  return sessions.reduce((s, x) => s + (Number(x.duration) || 0), 0);
}

async function avgSessionMinutes(userId, startUtc, endUtc) {
  const sessions = await prisma.focusSession.findMany({
    where: { userId, startedAt: { gte: startUtc, lt: endUtc } },
    select: { duration: true },
  });
  if (sessions.length === 0) return 0;
  const sum = sessions.reduce((s, x) => s + (Number(x.duration) || 0), 0);
  return Math.round(sum / sessions.length);
}

async function countCompletedTasks(userId, startUtc, endUtc) {
  return prisma.task.count({
    where: {
      userId,
      status: "done",
      completedAt: { gte: startUtc, lt: endUtc },
    },
  });
}

async function countPlannedTasks(userId, startUtc, endUtc) {
  return prisma.task.count({
    where: {
      userId,
      dueDate: { gte: startUtc, lt: endUtc },
    },
  });
}

async function periodSlice(userId, startUtc, endUtc, streakDays) {
  const [focusMinutes, avgSession, completed, planned] = await Promise.all([
    sumFocusMinutes(userId, startUtc, endUtc),
    avgSessionMinutes(userId, startUtc, endUtc),
    countCompletedTasks(userId, startUtc, endUtc),
    countPlannedTasks(userId, startUtc, endUtc),
  ]);
  let tasksPlanned = planned;
  if (tasksPlanned === 0 && completed > 0) tasksPlanned = completed;
  return {
    tasksCompleted: completed,
    tasksPlanned,
    focusMinutes,
    avgSessionMinutes: avgSession,
    streakDays,
  };
}

// GET /analytics/dashboard?interval=day|week|month&tzOffsetMinutes=...
router.get("/dashboard", async (req, res) => {
  try {
    const userId = req.user.id;
    const interval = String(req.query.interval || "week");
    if (!["day", "week", "month"].includes(interval)) {
      return res.status(400).json({ error: "interval must be day, week, or month" });
    }
    const tzOffsetMinutes = parseTzOffsetMinutes(req.query.tzOffsetMinutes);

    const now = new Date();
    const todayKey = localKeyFromUtcDate(now, tzOffsetMinutes);
    const tomorrowKey = addLocalDays(todayKey, 1);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { streakCount: true },
    });
    const streakDays =
      typeof user?.streakCount === "number" ? Math.max(0, user.streakCount) : 0;

    let currentRange;
    let previousRange;
    let heroTitle;
    let compareLabel;
    let trendBars;
    let loadBars;
    let completeBars;

    if (interval === "day") {
      currentRange = rangeUtc(todayKey, tomorrowKey, tzOffsetMinutes);
      const yKey = addLocalDays(todayKey, -1);
      previousRange = rangeUtc(yKey, todayKey, tzOffsetMinutes);
      heroTitle = "Today";
      compareLabel = "vs yesterday";

      const { startUtc, endUtc } = currentRange;
      const span = endUtc.getTime() - startUtc.getTime();
      const n = 7;
      trendBars = Array(n).fill(0);
      loadBars = Array(n).fill(0);
      completeBars = Array(n).fill(0);

      const [sessions, dones, loads] = await Promise.all([
        prisma.focusSession.findMany({
          where: { userId, startedAt: { gte: startUtc, lt: endUtc } },
          select: { duration: true, startedAt: true },
        }),
        prisma.task.findMany({
          where: {
            userId,
            status: "done",
            completedAt: { gte: startUtc, lt: endUtc },
          },
          select: { completedAt: true },
        }),
        prisma.task.findMany({
          where: { userId, dueDate: { gte: startUtc, lt: endUtc } },
          select: { dueDate: true },
        }),
      ]);
      for (const s of sessions) {
        const idx = Math.min(
          n - 1,
          Math.floor(((s.startedAt.getTime() - startUtc.getTime()) / span) * n)
        );
        trendBars[idx] += Number(s.duration) || 0;
      }
      for (const t of dones) {
        const idx = Math.min(
          n - 1,
          Math.floor(((t.completedAt.getTime() - startUtc.getTime()) / span) * n)
        );
        completeBars[idx] += 1;
      }
      for (const t of loads) {
        const idx = Math.min(
          n - 1,
          Math.floor(((t.dueDate.getTime() - startUtc.getTime()) / span) * n)
        );
        loadBars[idx] += 1;
      }
    } else if (interval === "week") {
      const currentStartKey = addLocalDays(todayKey, -6);
      currentRange = rangeUtc(currentStartKey, tomorrowKey, tzOffsetMinutes);
      const prevEndExclusive = currentStartKey;
      const prevStartKey = addLocalDays(todayKey, -13);
      previousRange = rangeUtc(prevStartKey, prevEndExclusive, tzOffsetMinutes);
      heroTitle = "Last 7 days";
      compareLabel = "vs prior 7 days";

      const dayKeys = [];
      for (let i = 0; i < 7; i++) dayKeys.push(addLocalDays(currentStartKey, i));
      const keyToIdx = new Map(dayKeys.map((k, i) => [k, i]));
      trendBars = Array(7).fill(0);
      loadBars = Array(7).fill(0);
      completeBars = Array(7).fill(0);

      const { startUtc, endUtc } = currentRange;
      const [sessions, dones, loads] = await Promise.all([
        prisma.focusSession.findMany({
          where: { userId, startedAt: { gte: startUtc, lt: endUtc } },
          select: { duration: true, startedAt: true },
        }),
        prisma.task.findMany({
          where: {
            userId,
            status: "done",
            completedAt: { gte: startUtc, lt: endUtc },
          },
          select: { completedAt: true },
        }),
        prisma.task.findMany({
          where: { userId, dueDate: { gte: startUtc, lt: endUtc } },
          select: { dueDate: true },
        }),
      ]);
      for (const s of sessions) {
        const k = localKeyFromUtcDate(s.startedAt, tzOffsetMinutes);
        const idx = keyToIdx.get(k);
        if (idx !== undefined) trendBars[idx] += Number(s.duration) || 0;
      }
      for (const t of dones) {
        const k = localKeyFromUtcDate(t.completedAt, tzOffsetMinutes);
        const idx = keyToIdx.get(k);
        if (idx !== undefined) completeBars[idx] += 1;
      }
      for (const t of loads) {
        const k = localKeyFromUtcDate(t.dueDate, tzOffsetMinutes);
        const idx = keyToIdx.get(k);
        if (idx !== undefined) loadBars[idx] += 1;
      }
    } else {
      const [y, m] = todayKey.split("-").map(Number);
      const firstThis = `${y}-${String(m).padStart(2, "0")}-01`;
      const nextM = m === 12 ? 1 : m + 1;
      const nextY = m === 12 ? y + 1 : y;
      const firstNext = `${nextY}-${String(nextM).padStart(2, "0")}-01`;
      const prevM = m === 1 ? 12 : m - 1;
      const prevY = m === 1 ? y - 1 : y;
      const firstPrev = `${prevY}-${String(prevM).padStart(2, "0")}-01`;

      currentRange = rangeUtc(firstThis, firstNext, tzOffsetMinutes);
      previousRange = rangeUtc(firstPrev, firstThis, tzOffsetMinutes);
      const monthNames = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
      ];
      heroTitle = `${monthNames[m - 1]} ${y}`;
      compareLabel = "vs last month";

      const days = [];
      for (let dk = firstThis; dk !== firstNext; dk = addLocalDays(dk, 1)) {
        days.push(dk);
      }
      const daysInMonth = days.length || 1;
      const n = 12;
      trendBars = Array(n).fill(0);
      loadBars = Array(n).fill(0);
      completeBars = Array(n).fill(0);

      const { startUtc, endUtc } = currentRange;
      const [sessions, dones, loads] = await Promise.all([
        prisma.focusSession.findMany({
          where: { userId, startedAt: { gte: startUtc, lt: endUtc } },
          select: { duration: true, startedAt: true },
        }),
        prisma.task.findMany({
          where: {
            userId,
            status: "done",
            completedAt: { gte: startUtc, lt: endUtc },
          },
          select: { completedAt: true },
        }),
        prisma.task.findMany({
          where: { userId, dueDate: { gte: startUtc, lt: endUtc } },
          select: { dueDate: true },
        }),
      ]);
      const segForDayIndex = (di) =>
        Math.min(n - 1, Math.floor((di * n) / daysInMonth));
      for (const s of sessions) {
        const k = localKeyFromUtcDate(s.startedAt, tzOffsetMinutes);
        const di = days.indexOf(k);
        if (di >= 0) trendBars[segForDayIndex(di)] += Number(s.duration) || 0;
      }
      for (const t of dones) {
        const k = localKeyFromUtcDate(t.completedAt, tzOffsetMinutes);
        const di = days.indexOf(k);
        if (di >= 0) completeBars[segForDayIndex(di)] += 1;
      }
      for (const t of loads) {
        const k = localKeyFromUtcDate(t.dueDate, tzOffsetMinutes);
        const di = days.indexOf(k);
        if (di >= 0) loadBars[segForDayIndex(di)] += 1;
      }
    }

    if (!currentRange || !previousRange) {
      return res.status(400).json({ error: "Invalid date range" });
    }

    const [current, previous] = await Promise.all([
      periodSlice(
        userId,
        currentRange.startUtc,
        currentRange.endUtc,
        streakDays
      ),
      periodSlice(
        userId,
        previousRange.startUtc,
        previousRange.endUtc,
        streakDays
      ),
    ]);

    return res.json({
      interval,
      heroTitle,
      compareLabel,
      current,
      previous,
      trendBars,
      loadBars,
      completeBars,
      windows: {
        current: {
          start: currentRange.startUtc.toISOString(),
          end: currentRange.endUtc.toISOString(),
        },
        previous: {
          start: previousRange.startUtc.toISOString(),
          end: previousRange.endUtc.toISOString(),
        },
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
