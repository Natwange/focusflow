const express = require("express");
const prisma = require("../lib/prisma");
const { requireOwnedResource } = require("../lib/ownership");
const { sanitizeUserText } = require("../lib/sanitizeInput");
const { validateBody } = require("../middleware/validateBody");
const { goalCreateBodySchema } = require("../validation/schemas");

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

function buildPlan({
  totalUnits,
  unitName,
  startDate,
  deadline,
  weights,
  unitStartAt = 1,
}) {
  const days = daysBetweenInclusive(startDate, deadline);
  if (days <= 0) return { error: "Deadline must be in the future" };
  if (totalUnits <= 0) return { error: "Total units must be > 0" };

  // Normalize weights into an array of length totalUnits.
  const normalizedWeights =
    Array.isArray(weights) && weights.length === totalUnits
      ? weights.map((w) => {
          const n = Number(w);
          return Number.isFinite(n) && n > 0 ? n : 1;
        })
      : Array.from({ length: totalUnits }, () => 1);

  const totalWeight = normalizedWeights.reduce((sum, w) => sum + w, 0) || 1;

  // Assign each unit to a day index [0..days-1], based on the "center" of its weight span.
  // This keeps the *last unit* on the deadline day, fixing the "deadline day got no plan content" issue.
  const unitToDay = new Array(totalUnits).fill(0);
  let prefixWeightBefore = 0;
  for (let u = 0; u < totalUnits; u++) {
    if (u === totalUnits - 1) {
      unitToDay[u] = days - 1; // force deadline to always have content (when totalUnits > 0)
    } else {
      const w = normalizedWeights[u];
      const midRatio = (prefixWeightBefore + w / 2) / totalWeight; // 0..1
      const dayIdx = Math.round(midRatio * (days - 1));
      unitToDay[u] = Math.max(0, Math.min(days - 1, dayIdx));
    }
    prefixWeightBefore += normalizedWeights[u];
  }

  // Group consecutive units that map to the same day.
  const items = [];
  let groupStart = 0;
  let groupDay = unitToDay[0];

  const pushGroup = (endExclusive) => {
    const startUnitIdx = groupStart; // 0-based within totalUnits
    const endUnitIdx = endExclusive - 1;

    const startUnit = unitStartAt + startUnitIdx;
    const endUnit = unitStartAt + endUnitIdx;
    const unitsPlanned = endUnit - startUnit + 1;

    const title =
      unitsPlanned === 1
        ? `${unitName} ${startUnit}`
        : `${unitName} ${startUnit}-${endUnit}`;

    const dueDate = startOfDay(
      new Date(startDate.getTime() + groupDay * 24 * 60 * 60 * 1000)
    );

    items.push({
      dueDate: dueDate.toISOString(),
      title,
      unitsPlanned,
      unitRange: { start: startUnit, end: endUnit },
    });
  };

  for (let u = 1; u < totalUnits; u++) {
    if (unitToDay[u] !== groupDay) {
      pushGroup(u);
      groupStart = u;
      groupDay = unitToDay[u];
    }
  }
  pushGroup(totalUnits);

  const perDay = totalUnits / days;
  return { days, perDay, items };
}

// POST /goals
router.post("/", validateBody(goalCreateBodySchema), async (req, res) => {
  try {
    const userId = req.user.id;
    const { title, totalUnits, unitName, deadline } = req.body;
    const safeTitle = sanitizeUserText(title);
    const safeUnitName = sanitizeUserText(unitName);

    const goal = await prisma.goal.create({
      data: {
        userId,
        title: safeTitle,
        totalUnits,
        unitName: safeUnitName,
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

    const goal = await requireOwnedResource({
      model: prisma.goal,
      id: goalId,
      userId,
      res,
      notFoundMessage: "Goal not found",
      forbiddenMessage: "Forbidden: goal does not belong to this user",
    });
    if (!goal) return;

    const updated = await prisma.goal.update({
      where: { id: goalId },
      data: {
        ...(title && { title: sanitizeUserText(title) }),
        ...(totalUnits !== undefined && { totalUnits: Number(totalUnits) }),
        ...(unitName && { unitName: sanitizeUserText(unitName) }),
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

    const goal = await requireOwnedResource({
      model: prisma.goal,
      id: goalId,
      userId,
      res,
      notFoundMessage: "Goal not found",
      forbiddenMessage: "Forbidden: goal does not belong to this user",
    });
    if (!goal) return;

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

    const goal = await requireOwnedResource({
      model: prisma.goal,
      id: goalId,
      userId,
      res,
      notFoundMessage: "Goal not found",
      forbiddenMessage: "Forbidden: goal does not belong to this user",
    });
    if (!goal) return;

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
    const { weights, startDate: startDateInput } = req.body || {};

    // fetch goal (must belong to user)
    const goal = await requireOwnedResource({
      model: prisma.goal,
      id: goalId,
      userId,
      res,
      notFoundMessage: "Goal not found",
      forbiddenMessage: "Forbidden: goal does not belong to this user",
      select: { id: true, title: true, totalUnits: true, unitName: true, deadline: true },
    });
    if (!goal) return;

    // start planning from the provided start date (or today if not provided)
    const startDate =
      startDateInput && typeof startDateInput === "string"
        ? startOfDay(new Date(startDateInput))
        : startOfDay(new Date());
    const deadline = startOfDay(new Date(goal.deadline));

    const plan = buildPlan({
      totalUnits: goal.totalUnits,
      unitName: goal.unitName,
      startDate,
      deadline,
      weights,
      unitStartAt: 1,
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
    const goal = await requireOwnedResource({
      model: prisma.goal,
      id: goalId,
      userId,
      res,
      notFoundMessage: "Goal not found",
      forbiddenMessage: "Forbidden: goal does not belong to this user",
      select: { id: true, totalUnits: true },
    });
    if (!goal) return;

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
            title: sanitizeUserText(it.title),
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

// POST /goals/:id/plan/refresh
// Re-balance a goal plan when the user has overdue plan tasks.
// Rules:
// - Keep all tasks with status == "done".
// - Delete tasks with status != "done" (todo/doing).
// - Compute how many units are already completed by parsing numeric ranges from titles.
// - Recreate tasks from "today" until goal.deadline (deadline day included).
router.post("/:id/plan/refresh", async (req, res) => {
  try {
    const userId = req.user.id;
    const goalId = req.params.id;

    const goal = await requireOwnedResource({
      model: prisma.goal,
      id: goalId,
      userId,
      res,
      notFoundMessage: "Goal not found",
      forbiddenMessage: "Forbidden: goal does not belong to this user",
      select: { id: true, title: true, totalUnits: true, unitName: true, deadline: true },
    });
    if (!goal) return;

    const todayStart = startOfDay(new Date());
    const deadline = startOfDay(new Date(goal.deadline));
    const remainingDays = daysBetweenInclusive(todayStart, deadline);
    if (remainingDays <= 0) return res.json({ refreshed: true, createdCount: 0, skipped: true });

    const parseTrailingUnitRange = (t) => {
      if (!t || typeof t !== "string") return null;
      // Match endings like "lessons 3-5" or "chapters 7"
      const m = t.trim().match(/(\d+)(?:-(\d+))?$/);
      if (!m) return null;
      const start = Number(m[1]);
      const end = m[2] ? Number(m[2]) : start;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
      return { start, end, unitsPlanned: end - start + 1 };
    };

    const doneTasks = await prisma.task.findMany({
      where: { userId, goalId: goal.id, status: "done" },
      select: { title: true, status: true },
    });

    const completedUnits = doneTasks.reduce((sum, t) => {
      const parsed = parseTrailingUnitRange(t.title);
      return sum + (parsed ? parsed.unitsPlanned : 0);
    }, 0);

    const remainingUnits = Math.max(goal.totalUnits - completedUnits, 0);

    // Remove only non-completed tasks; keep done tasks for progress history.
    await prisma.task.deleteMany({
      where: { userId, goalId: goal.id, status: { not: "done" } },
    });

    if (remainingUnits <= 0) {
      return res.json({ refreshed: true, createdCount: 0, remainingUnits: 0 });
    }

    const unitStartAt = completedUnits + 1;
    const plan = buildPlan({
      totalUnits: remainingUnits,
      unitName: goal.unitName,
      startDate: todayStart,
      deadline,
      unitStartAt,
      // For refresh we intentionally use even distribution (no weights) unless weights are stored.
      weights: null,
    });

    if (plan.error) return res.status(400).json({ error: plan.error });

    const created = await prisma.$transaction(
      plan.items.map((it) =>
        prisma.task.create({
          data: {
            userId,
            goalId: goal.id,
            title: sanitizeUserText(it.title),
            dueDate: it.dueDate ? new Date(it.dueDate) : null,
            estimatedMin: null,
            priority: "medium",
            status: "todo",
          },
          select: { id: true, title: true, dueDate: true, status: true, goalId: true },
        })
      )
    );

    return res.json({
      refreshed: true,
      createdCount: created.length,
      remainingUnits,
      unitStartAt,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
