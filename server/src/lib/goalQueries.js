const crypto = require("crypto");
const prisma = require("./prisma");
const { findOwnedResource } = require("./ownershipAssert");
const { sanitizeUserText } = require("./sanitizeInput");
const {
  PlanInputError,
  normalizeAvailableDays,
  resolveMaxUnitsPerDay,
  dayCodeOf,
} = require("./buildPlan");

/**
 * Create a goal for the authenticated user (same rules as POST /goals).
 */
async function createGoalForUser(
  userId,
  { title, totalUnits, unitName, deadline, availableDays, maxUnitsPerDay }
) {
  const safeTitle = sanitizeUserText(title);
  const safeUnitName = sanitizeUserText(unitName || "units");

  return prisma.goal.create({
    data: {
      userId,
      title: safeTitle,
      totalUnits: Number(totalUnits),
      unitName: safeUnitName,
      deadline: new Date(deadline),
      availableDays: normalizeAvailableDays(availableDays),
      ...(maxUnitsPerDay !== undefined && {
        maxUnitsPerDay: resolveMaxUnitsPerDay(maxUnitsPerDay),
      }),
    },
  });
}

/**
 * Confirm an initial goal plan and write Task rows (same rules as POST /goals/:id/plan/confirm).
 */
async function confirmGoalPlanForUser(
  userId,
  goalId,
  { items, availableDays, maxUnitsPerDay: maxUnitsPerDayBody }
) {
  const owned = await findOwnedResource({
    model: prisma.goal,
    id: goalId,
    userId,
    notFoundMessage: "Goal not found",
    forbiddenMessage: "Forbidden: goal does not belong to this user",
    select: {
      id: true,
      totalUnits: true,
      availableDays: true,
      maxUnitsPerDay: true,
      title: true,
    },
  });
  if (!owned.ok) {
    const err = new Error(owned.error);
    err.code = owned.code;
    throw err;
  }
  const goal = owned.record;

  if (!Array.isArray(items) || items.length === 0) {
    throw new PlanInputError("items array is required");
  }

  const confirmCap =
    maxUnitsPerDayBody !== undefined
      ? maxUnitsPerDayBody === null || maxUnitsPerDayBody === ""
        ? null
        : resolveMaxUnitsPerDay(maxUnitsPerDayBody)
      : goal.maxUnitsPerDay;

  const normalizedAvailableDays = normalizeAvailableDays(
    availableDays ?? goal.availableDays
  );
  const availableSet = new Set(normalizedAvailableDays);

  const existingCount = await prisma.task.count({ where: { userId, goalId } });
  if (existingCount > 0) {
    const err = new Error("Goal already has tasks. Delete them first to re-plan.");
    err.code = "ALREADY_PLANNED";
    throw err;
  }

  const plannedUnits = items.reduce(
    (sum, it) => sum + (Number(it.unitsPlanned) || 0),
    0
  );
  if (plannedUnits !== goal.totalUnits) {
    throw new PlanInputError(
      `Planned units (${plannedUnits}) must equal goal totalUnits (${goal.totalUnits})`
    );
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
    throw new PlanInputError(
      "Plan contains due dates outside selected availableDays. Re-run preview."
    );
  }

  if (confirmCap != null) {
    const overCap = items.some(
      (it) => (Number(it.unitsPlanned) || 0) > confirmCap
    );
    if (overCap) {
      throw new PlanInputError(
        `Each plan step must be at most ${confirmCap} units (your daily limit). Re-run preview.`
      );
    }
  }

  const planRunId = crypto.randomUUID();

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

  return created;
}

module.exports = { createGoalForUser, confirmGoalPlanForUser };
