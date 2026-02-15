const express = require("express");
const prisma = require("../lib/prisma");

const router = express.Router();

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function daysBetweenInclusive(start, end) {
  const msPerDay = 24 * 60 * 60 * 1000;
  const s = startOfDay(start).getTime();
  const e = startOfDay(end).getTime();
  return Math.floor((e - s) / msPerDay) + 1;
}

function buildPlan({ totalUnits, unitName, startDate, deadline }) {
  const days = daysBetweenInclusive(startDate, deadline);
  if (days <= 0) {
    return { error: "Deadline must be in the future" };
  }

  const perDay = Math.ceil(totalUnits / days);
  let remaining = totalUnits;

  const items = [];
  let unitCursor = 1;

  for (let i = 0; i < days; i++) {
    if (remaining <= 0) break;

    const date = startOfDay(new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000));
    const take = Math.min(perDay, remaining);

    const startUnit = unitCursor;
    const endUnit = unitCursor + take - 1;

    const title =
      take === 1
        ? `${unitName} ${startUnit}`
        : `${unitName} ${startUnit}-${endUnit}`;

    items.push({
      dueDate: date.toISOString(),
      title,
      unitsPlanned: take,
      unitRange: { start: startUnit, end: endUnit },
    });

    unitCursor += take;
    remaining -= take;
  }

  return { days, perDay, items };
}

// POST /goals
router.post("/", async (req, res) => {
  try {
    const userId = req.user.id;
    const { title, totalUnits, unitName, deadline } = req.body;

    if (!title || !totalUnits || !unitName || !deadline) {
      return res.status(400).json({
        error: "title, totalUnits, unitName, and deadline are required",
      });
    }

    const goal = await prisma.goal.create({
      data: {
        userId,
        title,
        totalUnits: Number(totalUnits),
        unitName,
        deadline: new Date(deadline),
      },
    });

    return res.status(201).json(goal);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /goals
router.get("/", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const goals = await prisma.goal.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: { tasks: true },
    });

    return res.json(goals);
  } catch (err) {
    console.error(err);
    const message =
      err.code === "ETIMEDOUT" || err.code === "P1001"
        ? "Database connection failed. Check that your database is running and DATABASE_URL is correct."
        : "Internal server error";
    return res.status(500).json({ error: message });
  }
});

// PUT /goals/:id (update a goal)
router.put("/:id", async (req, res) => {
  try {
    const userId = req.user.id;
    const goalId = req.params.id;
    const { title, totalUnits, unitName, deadline } = req.body;

    const goal = await prisma.goal.findFirst({
      where: { id: goalId, userId },
    });

    if (!goal) return res.status(404).json({ error: "Goal not found" });

    const updated = await prisma.goal.update({
      where: { id: goalId },
      data: {
        ...(title && { title }),
        ...(totalUnits !== undefined && { totalUnits: Number(totalUnits) }),
        ...(unitName && { unitName }),
        ...(deadline && { deadline: new Date(deadline) }),
      },
      include: { tasks: true },
    });

    return res.json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /goals/:id (delete a goal and its tasks)
router.delete("/:id", async (req, res) => {
  try {
    const userId = req.user.id;
    const goalId = req.params.id;

    const goal = await prisma.goal.findFirst({
      where: { id: goalId, userId },
      select: { id: true },
    });

    if (!goal) return res.status(404).json({ error: "Goal not found" });

    // Delete tasks first (cascade)
    await prisma.task.deleteMany({
      where: { userId, goalId },
    });

    // Delete the goal
    await prisma.goal.delete({
      where: { id: goalId },
    });

    return res.json({ ok: true, goalId });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /goals/:id/tasks  (clear all tasks for a goal you own)
router.delete("/:id/tasks", async (req, res) => {
  try {
    const userId = req.user.id;
    const goalId = req.params.id;

    const goal = await prisma.goal.findFirst({
      where: { id: goalId, userId },
      select: { id: true },
    });

    if (!goal) return res.status(404).json({ error: "Goal not found" });

    const result = await prisma.task.deleteMany({
      where: { userId, goalId },
    });

    return res.json({ ok: true, deletedCount: result.count, goalId });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /goals/:id/plan/preview
router.post("/:id/plan/preview", async (req, res) => {
  try {
    const userId = req.user.id;
    const goalId = req.params.id;

    // fetch goal (must belong to user)
    const goal = await prisma.goal.findFirst({
      where: { id: goalId, userId },
      select: { id: true, title: true, totalUnits: true, unitName: true, deadline: true },
    });

    if (!goal) return res.status(404).json({ error: "Goal not found" });

    // start planning from today (simple MVP)
    const startDate = startOfDay(new Date());
    const deadline = new Date(goal.deadline);

    const plan = buildPlan({
      totalUnits: goal.totalUnits,
      unitName: goal.unitName,
      startDate,
      deadline,
    });

    if (plan.error) return res.status(400).json({ error: plan.error });

    return res.json({
      goal: {
        id: goal.id,
        title: goal.title,
        totalUnits: goal.totalUnits,
        unitName: goal.unitName,
        deadline: goal.deadline,
      },
      planning: {
        startDate: startDate.toISOString(),
        daysAvailable: plan.days,
        unitsPerDayTarget: plan.perDay,
      },
      items: plan.items,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /goals/:id/plan/confirm
router.post("/:id/plan/confirm", async (req, res) => {
  try {
    const userId = req.user.id;
    const goalId = req.params.id;

    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items array is required" });
    }

    // confirm goal belongs to user
    const goal = await prisma.goal.findFirst({
      where: { id: goalId, userId },
      select: { id: true, totalUnits: true },
    });
    if (!goal) return res.status(404).json({ error: "Goal not found" });

    // prevent duplicate auto-plans for MVP
    const existingCount = await prisma.task.count({ where: { userId, goalId } });
    if (existingCount > 0) {
      return res.status(409).json({ error: "Goal already has tasks. Delete them first to re-plan." });
    }

    // basic sanity: total planned units must equal goal totalUnits
    const plannedUnits = items.reduce((sum, it) => sum + (Number(it.unitsPlanned) || 0), 0);
    if (plannedUnits !== goal.totalUnits) {
      return res.status(400).json({
        error: `Planned units (${plannedUnits}) must equal goal totalUnits (${goal.totalUnits})`,
      });
    }

    // create tasks in a transaction
    const created = await prisma.$transaction(
      items.map((it) =>
        prisma.task.create({
          data: {
            userId,
            goalId,
            title: String(it.title),
            dueDate: it.dueDate ? new Date(it.dueDate) : null,
            estimatedMin: null,
            status: "todo",
          },
          select: { id: true, title: true, dueDate: true, status: true, goalId: true },
        })
      )
    );

    return res.status(201).json({ createdCount: created.length, tasks: created });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
