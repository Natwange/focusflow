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

module.exports = router;
