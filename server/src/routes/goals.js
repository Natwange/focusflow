const express = require("express");
const crypto = require("crypto");
const prisma = require("../lib/prisma");
const { prismaErrorMessage } = require("../lib/prismaErrors");
const { requireOwnedResource } = require("../lib/ownership");
const { sanitizeUserText } = require("../lib/sanitizeInput");
const {
  buildPlan,
  startOfDay,
  PlanInputError,
  normalizeAvailableDays,
  dayCodeOf,
  resolveMaxUnitsPerDay,
  getEligibleDates,
  computeDeadlineRisk,
} = require("../lib/buildPlan");
const { validateBody } = require("../middleware/validateBody");
const {
  goalCreateBodySchema,
  rebalanceConfirmBodySchema,
} = require("../validation/schemas");
const {
  parseTrailingUnitRange,
  buildRebalancePreview,
  assertStrategy,
  earliestDeadlineFitting,
} = require("../lib/rebalanceRecovery");
const { evaluateGoalProgress } = require("../lib/evaluationEngine");
const { detectFailureModes } = require("../lib/failureModeDetector");
const { recommendRebalance } = require("../lib/rebalanceRecommendationEngine");
const { runGoalAgent } = require("../lib/goalAgentOrchestrator");

const router = express.Router();

async function loadRebalanceContext(goalId, userId, res) {
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
      createdAt: true,
    },
  });
  if (!goal) return null;

  const doneTasks = await prisma.task.findMany({
    where: { userId, goalId: goal.id, status: "done" },
    select: { title: true, unitStart: true, unitEnd: true },
  });

  const completedUnits = doneTasks.reduce((sum, t) => {
    if (
      Number.isInteger(t.unitStart) &&
      Number.isInteger(t.unitEnd) &&
      t.unitEnd >= t.unitStart
    ) {
      return sum + (t.unitEnd - t.unitStart + 1);
    }
    const parsed = parseTrailingUnitRange(t.title);
    return sum + (parsed ? parsed.unitsPlanned : 0);
  }, 0);

  const preview = buildRebalancePreview({
    goal,
    completedUnits,
    today: new Date(),
  });

  return { goal, preview, completedUnits };
}

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

// GET /goals/:id/evaluation
// Read-only progress evaluation based on goal tasks + metadata.
router.get("/:id/evaluation", async (req, res) => {
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
        userId: true,
        createdAt: true,
        deadline: true,
      },
    });
    if (!goal) return;

    const tasks = await prisma.task.findMany({
      where: { userId, goalId },
      select: {
        status: true,
        dueDate: true,
        unitStart: true,
        unitEnd: true,
      },
    });

    const evaluation = evaluateGoalProgress({
      goal,
      tasks,
      now: new Date(),
    });

    return res.json({
      goalId: goal.id,
      evaluation,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: prismaErrorMessage(err) });
  }
});

// GET /goals/:id/failure-analysis
// Read-only failure analysis derived from evaluation + tasks metadata.
router.get("/:id/failure-analysis", async (req, res) => {
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
        userId: true,
        createdAt: true,
        deadline: true,
        availableDays: true,
        maxUnitsPerDay: true,
      },
    });
    if (!goal) return;

    const tasks = await prisma.task.findMany({
      where: { userId, goalId },
      select: {
        status: true,
        dueDate: true,
        unitStart: true,
        unitEnd: true,
      },
    });

    const now = new Date();
    const evaluation = evaluateGoalProgress({ goal, tasks, now });
    const failureAnalysis = detectFailureModes({
      goal,
      tasks,
      evaluation,
      now,
    });

    return res.json({
      goalId: goal.id,
      evaluation,
      failureAnalysis,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: prismaErrorMessage(err) });
  }
});

// GET /goals/:id/rebalance-recommendation
// Read-only recommendation preview from evaluation + failure analysis.
router.get("/:id/rebalance-recommendation", async (req, res) => {
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
        userId: true,
        createdAt: true,
        deadline: true,
        availableDays: true,
        maxUnitsPerDay: true,
      },
    });
    if (!goal) return;

    const tasks = await prisma.task.findMany({
      where: { userId, goalId },
      select: {
        id: true,
        title: true,
        status: true,
        dueDate: true,
        unitStart: true,
        unitEnd: true,
      },
    });

    const now = new Date();
    const evaluation = evaluateGoalProgress({ goal, tasks, now });
    const failureAnalysis = detectFailureModes({
      goal,
      tasks,
      evaluation,
      now,
    });
    const rebalanceRecommendation = recommendRebalance({
      goal,
      tasks,
      evaluation,
      failureAnalysis,
      now,
    });

    return res.json({
      goalId: goal.id,
      evaluation,
      failureAnalysis,
      rebalanceRecommendation,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: prismaErrorMessage(err) });
  }
});

// GET /goals/:id/agent-preview
// Read-only orchestrated output combining evaluation, failure analysis, and rebalance recommendation.
router.get("/:id/agent-preview", async (req, res) => {
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
        userId: true,
        createdAt: true,
        deadline: true,
        availableDays: true,
        maxUnitsPerDay: true,
      },
    });
    if (!goal) return;

    const tasks = await prisma.task.findMany({
      where: { userId, goalId },
      select: {
        id: true,
        title: true,
        status: true,
        dueDate: true,
        unitStart: true,
        unitEnd: true,
      },
    });

    const result = runGoalAgent({
      goal,
      tasks,
      now: new Date(),
    });

    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: prismaErrorMessage(err) });
  }
});

// POST /goals/:id/apply-agent-rebalance
// Write endpoint: applies dueDate changes from orchestrated agent recommendation.
router.post("/:id/apply-agent-rebalance", async (req, res) => {
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
        userId: true,
        createdAt: true,
        deadline: true,
        availableDays: true,
        maxUnitsPerDay: true,
      },
    });
    if (!goal) return;

    const tasks = await prisma.task.findMany({
      where: { userId, goalId },
      select: {
        id: true,
        title: true,
        status: true,
        dueDate: true,
        unitStart: true,
        unitEnd: true,
      },
    });

    const agentResult = runGoalAgent({
      goal,
      tasks,
      now: new Date(),
    });

    const rec = agentResult.rebalanceRecommendation;
    if (!rec?.canRebalance) {
      return res.status(400).json({
        error: rec?.reason || "Rebalance cannot be applied.",
        nextAction: agentResult.nextAction || "manual_review",
      });
    }

    const taskById = new Map(tasks.map((t) => [String(t.id), t]));
    const plannedChanges = Array.isArray(rec.changes) ? rec.changes : [];
    const updateChanges = [];

    for (const change of plannedChanges) {
      const taskId = String(change?.taskId || "");
      const targetTask = taskById.get(taskId);
      if (!targetTask) {
        return res.status(400).json({
          error: `Invalid rebalance change target: ${taskId}`,
          nextAction: "manual_review",
        });
      }
      if (targetTask.status === "done") {
        continue;
      }
      const toDate = new Date(change.to);
      if (Number.isNaN(toDate.getTime())) {
        return res.status(400).json({
          error: `Invalid rebalance target date for task: ${taskId}`,
          nextAction: "manual_review",
        });
      }
      updateChanges.push({
        taskId,
        toDate,
      });
    }

    const updatedTasks =
      updateChanges.length > 0
        ? await prisma.$transaction(
            updateChanges.map((c) =>
              prisma.task.update({
                where: { id: c.taskId },
                data: { dueDate: c.toDate },
                select: {
                  id: true,
                  title: true,
                  status: true,
                  dueDate: true,
                  goalId: true,
                },
              })
            )
          )
        : [];

    return res.json({
      goalId: goal.id,
      applied: true,
      updatedTasks,
      agentResult,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: prismaErrorMessage(err) });
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

    const planRunId = crypto.randomUUID();

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
            planRunId,
            planSource: "initial_generation",
            unitStart:
              it?.unitRange && Number.isInteger(it.unitRange.start)
                ? it.unitRange.start
                : null,
            unitEnd:
              it?.unitRange && Number.isInteger(it.unitRange.end)
                ? it.unitRange.end
                : null,
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

// POST /goals/:id/plan/rebalance-preview
// Read-only: behind detection + recovery options (no task or goal mutations).
router.post("/:id/plan/rebalance-preview", async (req, res) => {
  try {
    const userId = req.user.id;
    const goalId = req.params.id;
    const ctx = await loadRebalanceContext(goalId, userId, res);
    if (!ctx) return;
    return res.json(ctx.preview);
  } catch (err) {
    if (err instanceof PlanInputError) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: prismaErrorMessage(err) });
  }
});

// POST /goals/:id/plan/rebalance-confirm
// Apply chosen strategy: updates goal when needed, deletes open tasks, recreates plan.
router.post(
  "/:id/plan/rebalance-confirm",
  validateBody(rebalanceConfirmBodySchema),
  async (req, res) => {
    try {
      const userId = req.user.id;
      const goalId = req.params.id;
      const { strategy } = req.body;

      assertStrategy(strategy);

      const ctx = await loadRebalanceContext(goalId, userId, res);
      if (!ctx) return;

      const chosen = ctx.preview.options.find((o) => o.strategy === strategy);
      if (!chosen || !chosen.feasible) {
        return res.status(400).json({
          error:
            "That recovery option is not available. Run rebalance-preview and pick a feasible strategy.",
        });
      }

      const { goal, completedUnits } = ctx;
      const remainingUnits = Math.max(goal.totalUnits - completedUnits, 0);
      const todayStart = startOfDay(new Date());
      const deadline0 = startOfDay(new Date(goal.deadline));
      const cap = resolveMaxUnitsPerDay(goal.maxUnitsPerDay);

      if (remainingUnits <= 0) {
        await prisma.task.deleteMany({
          where: { userId, goalId: goal.id, status: { not: "done" } },
        });
        return res.json({
          ok: true,
          strategy,
          createdCount: 0,
          remainingUnits: 0,
        });
      }

      if (strategy === "extend_deadline") {
        const ext = earliestDeadlineFitting({
          today: todayStart,
          initialDeadline: deadline0,
          remainingUnits,
          maxUnitsPerDay: cap,
          availableDays: goal.availableDays,
        });
        if (!ext) {
          return res.status(400).json({ error: "Could not compute extended deadline." });
        }
        await prisma.goal.update({
          where: { id: goal.id },
          data: { deadline: ext },
        });
      } else if (strategy === "increase_daily_load") {
        const eligibleToDeadline = getEligibleDates({
          startDate: todayStart,
          deadline: deadline0,
          availableDays: goal.availableDays,
        }).length;
        if (eligibleToDeadline <= 0) {
          return res.status(400).json({ error: "No eligible days left before deadline." });
        }
        const suggestedMax = Math.ceil(remainingUnits / eligibleToDeadline);
        await prisma.goal.update({
          where: { id: goal.id },
          data: { maxUnitsPerDay: suggestedMax },
        });
      }

      const goalFresh = await prisma.goal.findUnique({
        where: { id: goal.id },
      });
      if (!goalFresh) {
        return res.status(404).json({ error: "Goal not found" });
      }

      await prisma.task.deleteMany({
        where: { userId, goalId: goal.id, status: { not: "done" } },
      });

      const planDeadline = startOfDay(new Date(goalFresh.deadline));
      const maxForPlan =
        strategy === "spread_evenly" ? null : goalFresh.maxUnitsPerDay;

      const plan = buildPlan({
        totalUnits: remainingUnits,
        unitName: goalFresh.unitName,
        startDate: todayStart,
        deadline: planDeadline,
        availableDays: goalFresh.availableDays,
        maxUnitsPerDay: maxForPlan,
        unitStartAt: completedUnits + 1,
        weights: null,
      });

      const planRunId = crypto.randomUUID();

      const created = await prisma.$transaction(
        plan.items.map((it) =>
          prisma.task.create({
            data: {
              userId,
              goalId: goalFresh.id,
              title: sanitizeUserText(it.title),
              dueDate: it.dueDate ? new Date(it.dueDate) : null,
              estimatedMin: null,
              priority: "medium",
              status: "todo",
              planRunId,
              planSource: "rebalance",
              unitStart:
                it?.unitRange && Number.isInteger(it.unitRange.start)
                  ? it.unitRange.start
                  : null,
              unitEnd:
                it?.unitRange && Number.isInteger(it.unitRange.end)
                  ? it.unitRange.end
                  : null,
            },
            select: { id: true, title: true, dueDate: true, status: true, goalId: true },
          })
        )
      );

      return res.json({
        ok: true,
        strategy,
        createdCount: created.length,
        remainingUnits,
        goal: {
          id: goalFresh.id,
          deadline: goalFresh.deadline,
          maxUnitsPerDay: goalFresh.maxUnitsPerDay,
        },
      });
    } catch (err) {
      if (err instanceof PlanInputError) {
        return res.status(400).json({ error: err.message });
      }
      console.error(err);
      return res.status(500).json({ error: prismaErrorMessage(err) });
    }
  }
);

// POST /goals/:id/plan/refresh — alias for rebalance-preview (no automatic writes).
router.post("/:id/plan/refresh", async (req, res) => {
  try {
    const userId = req.user.id;
    const goalId = req.params.id;
    const ctx = await loadRebalanceContext(goalId, userId, res);
    if (!ctx) return;
    return res.json(ctx.preview);
  } catch (err) {
    if (err instanceof PlanInputError) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: prismaErrorMessage(err) });
  }
});

module.exports = router;
