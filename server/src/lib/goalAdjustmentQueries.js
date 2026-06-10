const crypto = require("crypto");
const prisma = require("./prisma");
const { sanitizeUserText } = require("./sanitizeInput");
const { parseGoalDeadline } = require("./goalDeadlineParser");
const { parseTrailingUnitRange } = require("./rebalanceRecovery");
const { requireOwnedGoal } = require("./goalAgentQueries");
const {
  buildPlan,
  startOfDay,
  PlanInputError,
  resolveMaxUnitsPerDay,
  getEligibleDates,
  computeDeadlineRisk,
} = require("./buildPlan");

async function computeCompletedUnits(userId, goalId) {
  const doneTasks = await prisma.task.findMany({
    where: { userId, goalId, status: "done" },
    select: { title: true, unitStart: true, unitEnd: true },
  });

  return doneTasks.reduce((sum, t) => {
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
}

/**
 * @param {object} goal
 * @param {object} opts
 * @param {number} [tzOffsetMinutes]
 */
function resolveAdjustmentParams(goal, opts, tzOffsetMinutes = 0) {
  const todayStart = startOfDay(new Date());

  let deadline = startOfDay(new Date(goal.deadline));
  if (opts.deadline) {
    const parsed = parseGoalDeadline(opts.deadline, tzOffsetMinutes);
    deadline = startOfDay(new Date(parsed));
  }

  if (deadline.getTime() < todayStart.getTime()) {
    throw new PlanInputError("Deadline must be today or later.");
  }

  let maxUnitsPerDay;
  if (opts.spreadEvenly === true) {
    maxUnitsPerDay = null;
  } else if (opts.maxUnitsPerDay !== undefined) {
    maxUnitsPerDay =
      opts.maxUnitsPerDay === null
        ? null
        : resolveMaxUnitsPerDay(opts.maxUnitsPerDay);
  } else {
    maxUnitsPerDay = goal.maxUnitsPerDay;
  }

  return { todayStart, deadline, maxUnitsPerDay };
}

/**
 * @param {string} userId
 * @param {string} goalId
 * @param {object} opts
 * @param {number} [tzOffsetMinutes]
 */
async function previewGoalAdjustmentForUser(
  userId,
  goalId,
  opts = {},
  tzOffsetMinutes = 0
) {
  const goal = await requireOwnedGoal(userId, goalId);
  const completedUnits = await computeCompletedUnits(userId, goal.id);
  const remainingUnits = Math.max(goal.totalUnits - completedUnits, 0);

  if (remainingUnits <= 0) {
    return {
      goalId: goal.id,
      goalTitle: goal.title,
      completedUnits,
      remainingUnits: 0,
      feasible: false,
      reason: "All units for this goal are already completed. Nothing to replan.",
      current: {
        deadline: goal.deadline,
        maxUnitsPerDay: goal.maxUnitsPerDay,
      },
      proposed: null,
      items: [],
    };
  }

  const { todayStart, deadline, maxUnitsPerDay } = resolveAdjustmentParams(
    goal,
    opts,
    tzOffsetMinutes
  );

  const eligibleDates = getEligibleDates({
    startDate: todayStart,
    deadline,
    availableDays: goal.availableDays,
  });
  if (eligibleDates.length <= 0) {
    throw new PlanInputError(
      "No eligible study days between today and that deadline on your available days."
    );
  }

  const capForRisk =
    maxUnitsPerDay == null ? null : resolveMaxUnitsPerDay(maxUnitsPerDay);
  const risk = computeDeadlineRisk(remainingUnits, eligibleDates.length, capForRisk);

  if (risk.riskLevel === "impossible") {
    return {
      goalId: goal.id,
      goalTitle: goal.title,
      completedUnits,
      remainingUnits,
      feasible: false,
      reason: `Cannot fit ${remainingUnits} remaining units by ${deadline.toISOString().slice(0, 10)} with these constraints. Try a later deadline, spread evenly, or a higher daily cap.`,
      current: {
        deadline: goal.deadline,
        maxUnitsPerDay: goal.maxUnitsPerDay,
      },
      proposed: {
        deadline: deadline.toISOString(),
        maxUnitsPerDay,
        spreadEvenly: opts.spreadEvenly === true,
        estimatedAvgUnitsPerDay: risk.requiredUnitsPerDay,
        eligibleDays: eligibleDates.length,
        riskLevel: risk.riskLevel,
      },
      items: [],
      planning: {
        riskLevel: risk.riskLevel,
        requiredUnitsPerDay: risk.requiredUnitsPerDay,
        eligibleDays: eligibleDates.length,
      },
    };
  }

  const plan = buildPlan({
    totalUnits: remainingUnits,
    unitName: goal.unitName,
    startDate: todayStart,
    deadline,
    availableDays: goal.availableDays,
    maxUnitsPerDay,
    unitStartAt: completedUnits + 1,
    weights: null,
  });

  const avgLoad =
    eligibleDates.length > 0 ? remainingUnits / eligibleDates.length : 0;

  return {
    goalId: goal.id,
    goalTitle: goal.title,
    completedUnits,
    remainingUnits,
    feasible: true,
    reason: null,
    current: {
      deadline: goal.deadline,
      maxUnitsPerDay: goal.maxUnitsPerDay,
    },
    proposed: {
      deadline: deadline.toISOString(),
      maxUnitsPerDay,
      spreadEvenly: opts.spreadEvenly === true,
      estimatedAvgUnitsPerDay: Math.round(avgLoad * 100) / 100,
      maxUnitsPerDayInPlan: plan.maxUnitsPerDay,
      eligibleDays: eligibleDates.length,
      taskGroupCount: plan.items.length,
      riskLevel: plan.riskLevel,
    },
    items: plan.items,
    planning: {
      startDate: todayStart.toISOString(),
      daysAvailable: plan.days,
      unitsPerDayTarget: plan.unitsPerDayTarget,
      maxUnitsPerDay: plan.maxUnitsPerDay,
      riskLevel: plan.riskLevel,
      requiredUnitsPerDay: plan.requiredUnitsPerDay,
      eligibleDays: plan.eligibleDays,
    },
  };
}

/**
 * @param {string} userId
 * @param {string} goalId
 * @param {object} opts
 * @param {number} [tzOffsetMinutes]
 */
async function applyGoalAdjustmentForUser(
  userId,
  goalId,
  opts = {},
  tzOffsetMinutes = 0
) {
  const preview = await previewGoalAdjustmentForUser(
    userId,
    goalId,
    opts,
    tzOffsetMinutes
  );

  if (!preview.feasible || !Array.isArray(preview.items) || preview.items.length === 0) {
    const err = new Error(preview.reason || "Goal adjustment is not feasible.");
    err.code = "ADJUSTMENT_NOT_FEASIBLE";
    err.preview = preview;
    throw err;
  }

  const goal = await requireOwnedGoal(userId, goalId);
  const { todayStart, deadline, maxUnitsPerDay } = resolveAdjustmentParams(
    goal,
    opts,
    tzOffsetMinutes
  );

  const goalUpdates = {};
  if (opts.deadline) {
    goalUpdates.deadline = deadline;
  }
  if (opts.spreadEvenly === true) {
    goalUpdates.maxUnitsPerDay = null;
  } else if (opts.maxUnitsPerDay !== undefined) {
    goalUpdates.maxUnitsPerDay = maxUnitsPerDay;
  }

  if (Object.keys(goalUpdates).length > 0) {
    await prisma.goal.update({
      where: { id: goal.id },
      data: goalUpdates,
    });
  }

  await prisma.task.deleteMany({
    where: { userId, goalId: goal.id, status: { not: "done" } },
  });

  const planRunId = crypto.randomUUID();
  const created = await prisma.$transaction(
    preview.items.map((it) =>
      prisma.task.create({
        data: {
          userId,
          goalId: goal.id,
          title: sanitizeUserText(it.title),
          dueDate: it.dueDate ? new Date(it.dueDate) : null,
          estimatedMin: null,
          priority: "medium",
          status: "todo",
          planRunId,
          planSource: "user_adjustment",
          unitStart:
            it?.unitRange && Number.isInteger(it.unitRange.start)
              ? it.unitRange.start
              : null,
          unitEnd:
            it?.unitRange && Number.isInteger(it.unitRange.end)
              ? it.unitRange.end
              : null,
        },
        select: {
          id: true,
          title: true,
          dueDate: true,
          status: true,
          goalId: true,
        },
      })
    )
  );

  const goalFresh = await prisma.goal.findUnique({
    where: { id: goal.id },
    select: {
      id: true,
      title: true,
      deadline: true,
      maxUnitsPerDay: true,
      totalUnits: true,
    },
  });

  return {
    goalId: goal.id,
    goalTitle: goal.title,
    applied: true,
    createdCount: created.length,
    completedUnits: preview.completedUnits,
    remainingUnits: preview.remainingUnits,
    goal: goalFresh,
    tasks: created,
    proposed: preview.proposed,
  };
}

module.exports = {
  previewGoalAdjustmentForUser,
  applyGoalAdjustmentForUser,
  computeCompletedUnits,
};
