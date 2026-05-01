const express = require("express");
const prisma = require("../lib/prisma");
const { prismaErrorMessage } = require("../lib/prismaErrors");
const { requireOwnedResource } = require("../lib/ownership");
const { sanitizeUserText } = require("../lib/sanitizeInput");
const {
  buildPlan,
  startOfDay,
  daysBetweenInclusive,
  PlanInputError,
  normalizeAvailableDays,
  dayCodeOf,
  resolveMaxUnitsPerDay,
  getEligibleDates,
  computeDeadlineRisk,
} = require("../lib/buildPlan");
const { validateBody } = require("../middleware/validateBody");
const { goalCreateBodySchema } = require("../validation/schemas");

const router = express.Router();

// POST /goals
router.post("/", validateBody(goalCreateBodySchema), async (req, res) => {
  try {
    const userId = req.user.id;
    const { title, totalUnits, unitName, deadline, availableDays, maxUnitsPerDay } = req.body;
    const safeTitle = sanitizeUserText(title);
    const safeUnitName = sanitizeUserText(unitName);

    const goal = await prisma.goal.create({
      data: {
        userId,
        title: safeTitle,
        totalUnits,
        unitName: safeUnitName,
        deadline: new Date(deadline),
        availableDays: normalizeAvailableDays(availableDays),
        ...(maxUnitsPerDay !== undefined && {
          maxUnitsPerDay: resolveMaxUnitsPerDay(maxUnitsPerDay),
        }),
      },
    });

    return res.status(201).json(goal);
  } catch (err) {
    if (err instanceof PlanInputError) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: prismaErrorMessage(err) });
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
        : prismaErrorMessage(err);
    return res.status(500).json({ error: message });
  }
});

// PUT /goals/:id (update a goal)
router.put("/:id", async (req, res) => {
  try {
    const userId = req.user.id;
    const goalId = req.params.id;
    const { title, totalUnits, unitName, deadline, availableDays, maxUnitsPerDay } = req.body;

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
        ...(availableDays !== undefined && { availableDays: normalizeAvailableDays(availableDays) }),
        ...(maxUnitsPerDay !== undefined && {
          maxUnitsPerDay:
            maxUnitsPerDay === null || maxUnitsPerDay === ""
              ? null
              : resolveMaxUnitsPerDay(maxUnitsPerDay),
        }),
      },
      include: { tasks: true },
    });

    return res.json(updated);
  } catch (err) {
    if (err instanceof PlanInputError) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: prismaErrorMessage(err) });
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
    return res.status(500).json({ error: prismaErrorMessage(err) });
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
    return res.status(500).json({ error: prismaErrorMessage(err) });
  }
});

// POST /goals/:id/plan/preview
router.post("/:id/plan/preview", async (req, res) => {
  try {
    const userId = req.user.id;
    const goalId = req.params.id;
    const {
      weights,
      startDate: startDateInput,
      availableDays: availableDaysInput,
      maxUnitsPerDay: maxUnitsPerDayInput,
    } = req.body || {};

    // fetch goal (must belong to user)
    const goal = await requireOwnedResource({
      model: prisma.goal,
      id: goalId,
      userId,
      res,
      notFoundMessage: "Goal not found",
      forbiddenMessage: "Forbidden: goal does not belong to this user",
      select: {
        id: true,
        title: true,
        totalUnits: true,
        unitName: true,
        deadline: true,
        availableDays: true,
        maxUnitsPerDay: true,
      },
    });
    if (!goal) return;

    const effectiveMax =
      maxUnitsPerDayInput !== undefined
        ? maxUnitsPerDayInput === null || maxUnitsPerDayInput === ""
          ? null
          : resolveMaxUnitsPerDay(maxUnitsPerDayInput)
        : goal.maxUnitsPerDay;

    // start planning from the provided start date (or today if not provided)
    const startDate =
      startDateInput && typeof startDateInput === "string"
        ? startOfDay(new Date(startDateInput))
        : startOfDay(new Date());
    const deadline = startOfDay(new Date(goal.deadline));
    const availableForPlan = availableDaysInput ?? goal.availableDays;

    const eligibleDates = getEligibleDates({
      startDate,
      deadline,
      availableDays: availableForPlan,
    });
    const eligibleDaysCount = eligibleDates.length;
    if (eligibleDaysCount <= 0) {
      throw new PlanInputError(
        "No eligible study days between start date and deadline. Choose available days that include at least one date in range."
      );
    }

    const capForRisk =
      effectiveMax == null ? null : resolveMaxUnitsPerDay(effectiveMax);

    const risk = computeDeadlineRisk(
      goal.totalUnits,
      eligibleDaysCount,
      capForRisk
    );

    if (risk.riskLevel === "impossible") {
      return res.json({
        goal: {
          id: goal.id,
          title: goal.title,
          totalUnits: goal.totalUnits,
          unitName: goal.unitName,
          deadline: goal.deadline,
          availableDays: normalizeAvailableDays(availableForPlan),
          maxUnitsPerDay: effectiveMax,
        },
        planning: {
          startDate: startDate.toISOString(),
          daysAvailable: eligibleDaysCount,
          unitsPerDayTarget: risk.requiredUnitsPerDay,
          maxUnitsPerDay: effectiveMax,
          riskLevel: risk.riskLevel,
          requiredUnitsPerDay: risk.requiredUnitsPerDay,
          eligibleDays: risk.eligibleDays,
        },
        items: [],
      });
    }

    const plan = buildPlan({
      totalUnits: goal.totalUnits,
      unitName: goal.unitName,
      startDate,
      deadline,
      availableDays: availableForPlan,
      maxUnitsPerDay: effectiveMax,
      weights,
      unitStartAt: 1,
    });

    return res.json({
      goal: {
        id: goal.id,
        title: goal.title,
        totalUnits: goal.totalUnits,
        unitName: goal.unitName,
        deadline: goal.deadline,
        availableDays: normalizeAvailableDays(availableForPlan),
        maxUnitsPerDay: effectiveMax,
      },
      planning: {
        startDate: startDate.toISOString(),
        daysAvailable: plan.days,
        unitsPerDayTarget: plan.perDay,
        maxUnitsPerDay: effectiveMax,
        riskLevel: plan.riskLevel,
        requiredUnitsPerDay: plan.requiredUnitsPerDay,
        eligibleDays: plan.eligibleDays,
      },
      items: plan.items,
    });
  } catch (err) {
    if (err instanceof PlanInputError) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: prismaErrorMessage(err) });
  }
});

// POST /goals/:id/plan/confirm
router.post("/:id/plan/confirm", async (req, res) => {
  try {
    const userId = req.user.id;
    const goalId = req.params.id;

    const { items, availableDays, maxUnitsPerDay: maxUnitsPerDayBody } = req.body;
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
      select: { id: true, totalUnits: true, availableDays: true, maxUnitsPerDay: true },
    });
    if (!goal) return;

    const confirmCap =
      maxUnitsPerDayBody !== undefined
        ? maxUnitsPerDayBody === null || maxUnitsPerDayBody === ""
          ? null
          : resolveMaxUnitsPerDay(maxUnitsPerDayBody)
        : goal.maxUnitsPerDay;

    const normalizedAvailableDays = normalizeAvailableDays(availableDays ?? goal.availableDays);
    const availableSet = new Set(normalizedAvailableDays);

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

    const hasInvalidDueDate = items.some((it) => {
      if (!it?.dueDate) return true;
      try {
        return !availableSet.has(dayCodeOf(new Date(it.dueDate)));
      } catch {
        return true;
      }
    });
    if (hasInvalidDueDate) {
      return res.status(400).json({
        error: "Plan contains due dates outside selected availableDays. Re-run preview.",
      });
    }

    if (confirmCap != null) {
      const overCap = items.some((it) => (Number(it.unitsPlanned) || 0) > confirmCap);
      if (overCap) {
        return res.status(400).json({
          error: `Each plan step must be at most ${confirmCap} units (your daily limit). Re-run preview.`,
        });
      }
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
    return res.status(500).json({ error: prismaErrorMessage(err) });
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
      select: {
        id: true,
        title: true,
        totalUnits: true,
        unitName: true,
        deadline: true,
        availableDays: true,
        maxUnitsPerDay: true,
      },
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
      availableDays: goal.availableDays,
      maxUnitsPerDay: goal.maxUnitsPerDay,
      unitStartAt,
      // For refresh we intentionally use even distribution (no weights) unless weights are stored.
      weights: null,
    });

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
    if (err instanceof PlanInputError) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: prismaErrorMessage(err) });
  }
});

module.exports = router;
