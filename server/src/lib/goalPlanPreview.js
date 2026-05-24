const prisma = require("./prisma");
const { findOwnedResource } = require("./ownershipAssert");
const {
  buildPlan,
  startOfDay,
  PlanInputError,
  normalizeAvailableDays,
  resolveMaxUnitsPerDay,
  getEligibleDates,
  computeDeadlineRisk,
} = require("./buildPlan");

/**
 * Read-only plan preview — same shape as POST /goals/:id/plan/preview (no task writes).
 */
async function previewGoalPlanForUser(
  userId,
  goalId,
  {
    weights = undefined,
    startDate: startDateInput = undefined,
    availableDays: availableDaysInput = undefined,
    maxUnitsPerDay: maxUnitsPerDayInput = undefined,
  } = {}
) {
  const owned = await findOwnedResource({
    model: prisma.goal,
    id: goalId,
    userId,
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
  if (!owned.ok) {
    const err = new Error(owned.error);
    err.code = owned.code;
    throw err;
  }
  const goal = owned.record;

  const effectiveMax =
    maxUnitsPerDayInput !== undefined
      ? maxUnitsPerDayInput === null || maxUnitsPerDayInput === ""
        ? null
        : resolveMaxUnitsPerDay(maxUnitsPerDayInput)
      : goal.maxUnitsPerDay;

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

  const capForRisk = effectiveMax == null ? null : resolveMaxUnitsPerDay(effectiveMax);

  const risk = computeDeadlineRisk(goal.totalUnits, eligibleDaysCount, capForRisk);

  const goalPayload = {
    id: goal.id,
    title: goal.title,
    totalUnits: goal.totalUnits,
    unitName: goal.unitName,
    deadline: goal.deadline,
    availableDays: normalizeAvailableDays(availableForPlan),
    maxUnitsPerDay: effectiveMax,
  };

  if (risk.riskLevel === "impossible") {
    return {
      goal: goalPayload,
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
    };
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

  return {
    goal: goalPayload,
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
  };
}

module.exports = { previewGoalPlanForUser };
