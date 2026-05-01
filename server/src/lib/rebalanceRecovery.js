const {
  buildPlan,
  getEligibleDates,
  PlanInputError,
  resolveMaxUnitsPerDay,
  startOfDay,
} = require("./buildPlan");

/**
 * Parse trailing unit range from task titles like "lessons 3-5" or "chapters 7".
 * @param {string | null | undefined} t
 * @returns {{ start: number, end: number, unitsPlanned: number } | null}
 */
function parseTrailingUnitRange(t) {
  if (!t || typeof t !== "string") return null;
  const m = t.trim().match(/(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2] ? Number(m[2]) : start;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return { start, end, unitsPlanned: end - start + 1 };
}

/**
 * Linear schedule: expected completed units by end of `today` (inclusive cap vs deadline).
 */
function computeExpectedUnitsByToday({
  totalUnits,
  planStart,
  today,
  deadline,
  availableDays,
}) {
  const start = startOfDay(planStart);
  const end = startOfDay(deadline);
  const now = startOfDay(today);

  const fullEligible = getEligibleDates({
    startDate: start,
    deadline: end,
    availableDays,
  }).length;

  if (fullEligible <= 0) return 0;

  const progressEnd = now.getTime() <= end.getTime() ? now : end;
  if (progressEnd.getTime() < start.getTime()) return 0;

  const elapsedEligible = getEligibleDates({
    startDate: start,
    deadline: progressEnd,
    availableDays,
  }).length;

  const raw = (totalUnits * elapsedEligible) / fullEligible;
  const expected = Math.round(raw);
  return Math.max(0, Math.min(totalUnits, expected));
}

function safeBuildPlan(args) {
  try {
    const plan = buildPlan({ ...args, weights: null });
    return { ok: true, plan };
  } catch (e) {
    if (e instanceof PlanInputError) {
      return { ok: false, error: e.message };
    }
    throw e;
  }
}

/**
 * Earliest deadline (UTC midnight end-of-range day) such that remaining units fit in [today, D] with cap.
 */
function earliestDeadlineFitting({
  today,
  initialDeadline,
  remainingUnits,
  maxUnitsPerDay,
  availableDays,
}) {
  const today0 = startOfDay(today);
  let d = startOfDay(initialDeadline);
  if (d.getTime() < today0.getTime()) {
    d = new Date(today0);
  }

  const maxDayMs = 800 * 24 * 60 * 60 * 1000;
  const limit = today0.getTime() + maxDayMs;

  while (d.getTime() <= limit) {
    const eligible = getEligibleDates({
      startDate: today0,
      deadline: d,
      availableDays,
    }).length;

    if (maxUnitsPerDay == null) {
      if (eligible >= 1 && remainingUnits > 0) return d;
      if (remainingUnits <= 0) return d;
    } else if (remainingUnits <= eligible * maxUnitsPerDay) {
      return d;
    }

    d = new Date(d.getTime() + 24 * 60 * 60 * 1000);
  }

  return null;
}

const STRATEGIES = [
  "keep_deadline",
  "spread_evenly",
  "increase_daily_load",
  "extend_deadline",
];

/**
 * @param {object} p
 * @param {object} p.goal — { totalUnits, unitName, deadline, availableDays, maxUnitsPerDay, createdAt }
 * @param {number} p.completedUnits
 * @param {Date} p.today
 */
function buildRebalancePreview({ goal, completedUnits, today }) {
  const deadline = startOfDay(new Date(goal.deadline));
  const today0 = startOfDay(today);
  const planStart = startOfDay(new Date(goal.createdAt));
  const availableDays = goal.availableDays;
  const totalUnits = goal.totalUnits;

  const expectedUnitsByToday = computeExpectedUnitsByToday({
    totalUnits,
    planStart,
    today: today0,
    deadline,
    availableDays,
  });

  const remainingUnits = Math.max(totalUnits - completedUnits, 0);
  const isBehind =
    remainingUnits > 0 && completedUnits < expectedUnitsByToday;

  const cap = resolveMaxUnitsPerDay(goal.maxUnitsPerDay);
  const eligibleToDeadline = getEligibleDates({
    startDate: today0,
    deadline,
    availableDays,
  }).length;

  const needPerDay =
    eligibleToDeadline > 0 ? remainingUnits / eligibleToDeadline : null;

  const options = [];

  const addOption = (o) => options.push(o);

  /** @type {{ ok: boolean, plan?: object }} */
  let keepResult = { ok: false };
  if (remainingUnits > 0 && eligibleToDeadline > 0) {
    keepResult = safeBuildPlan({
      totalUnits: remainingUnits,
      unitName: goal.unitName,
      startDate: today0,
      deadline,
      availableDays,
      maxUnitsPerDay: cap,
      unitStartAt: completedUnits + 1,
    });
  }

  addOption({
    strategy: "keep_deadline",
    label: "Keep deadline & daily cap",
    description:
      "Replan remaining units from today through your current deadline using your saved daily limit.",
    estimatedDailyLoad:
      needPerDay != null && Number.isFinite(needPerDay)
        ? Math.round(needPerDay * 100) / 100
        : 0,
    newDeadline: null,
    feasible: keepResult.ok,
  });

  let spreadResult = { ok: false };
  if (remainingUnits > 0 && eligibleToDeadline > 0) {
    spreadResult = safeBuildPlan({
      totalUnits: remainingUnits,
      unitName: goal.unitName,
      startDate: today0,
      deadline,
      availableDays,
      maxUnitsPerDay: null,
      unitStartAt: completedUnits + 1,
    });
  }

  const spreadLoad =
    eligibleToDeadline > 0 ? remainingUnits / eligibleToDeadline : 0;

  addOption({
    strategy: "spread_evenly",
    label: "Spread evenly (ignore daily cap)",
    description:
      "Distribute remaining work across eligible days through the current deadline without a per-day limit.",
    estimatedDailyLoad: Math.round(spreadLoad * 100) / 100,
    newDeadline: null,
    feasible: spreadResult.ok,
  });

  let suggestedMax = null;
  if (
    cap != null &&
    eligibleToDeadline > 0 &&
    remainingUnits > 0 &&
    needPerDay != null
  ) {
    suggestedMax = Math.ceil(remainingUnits / eligibleToDeadline);
  }

  let increaseResult = { ok: false };
  if (
    cap != null &&
    suggestedMax != null &&
    suggestedMax > cap &&
    eligibleToDeadline > 0 &&
    remainingUnits > 0
  ) {
    increaseResult = safeBuildPlan({
      totalUnits: remainingUnits,
      unitName: goal.unitName,
      startDate: today0,
      deadline,
      availableDays,
      maxUnitsPerDay: suggestedMax,
      unitStartAt: completedUnits + 1,
    });
  }

  const increaseFeasible =
    cap != null &&
    suggestedMax != null &&
    suggestedMax > cap &&
    increaseResult.ok;

  addOption({
    strategy: "increase_daily_load",
    label: "Raise daily limit",
    description:
      cap == null
        ? "You have no daily cap set; use spread evenly or keep deadline instead."
        : increaseFeasible
          ? `Increase max units per day to at least ${suggestedMax} to fit the remaining work by the deadline.`
          : suggestedMax != null && suggestedMax <= cap
            ? "Your current cap is already enough for an even split; try keeping the deadline or extending it if the planner still fails."
            : "Not enough eligible days left to rebalance with a higher cap.",
    estimatedDailyLoad:
      suggestedMax != null ? suggestedMax : Math.round((needPerDay || 0) * 100) / 100,
    newDeadline: null,
    suggestedMaxUnitsPerDay: increaseFeasible ? suggestedMax : null,
    feasible: increaseFeasible,
  });

  let extendedDeadline = null;
  if (cap != null && remainingUnits > 0) {
    extendedDeadline = earliestDeadlineFitting({
      today: today0,
      initialDeadline: deadline,
      remainingUnits,
      maxUnitsPerDay: cap,
      availableDays,
    });
  } else if (cap == null && remainingUnits > 0 && !spreadResult.ok) {
    extendedDeadline = earliestDeadlineFitting({
      today: today0,
      initialDeadline: deadline,
      remainingUnits,
      maxUnitsPerDay: null,
      availableDays,
    });
  }

  let extendFeasible = false;
  let extendPlanResult = { ok: false };
  if (extendedDeadline != null) {
    extendPlanResult = safeBuildPlan({
      totalUnits: remainingUnits,
      unitName: goal.unitName,
      startDate: today0,
      deadline: extendedDeadline,
      availableDays,
      maxUnitsPerDay: cap,
      unitStartAt: completedUnits + 1,
    });
    const strictlyLater =
      extendedDeadline.getTime() > deadline.getTime();
    const deadlinePassedNoWindow = eligibleToDeadline <= 0;
    extendFeasible =
      extendPlanResult.ok &&
      (strictlyLater || deadlinePassedNoWindow);
  }

  const extEligible =
    extendedDeadline != null
      ? getEligibleDates({
          startDate: today0,
          deadline: extendedDeadline,
          availableDays,
        }).length
      : 0;
  const extLoad =
    extEligible > 0 ? remainingUnits / extEligible : 0;

  addOption({
    strategy: "extend_deadline",
    label: "Extend deadline",
    description:
      extendedDeadline != null
        ? `Push the deadline to ${extendedDeadline.toISOString().slice(0, 10)} so remaining units fit at your current daily limit.`
        : cap == null
          ? "No extension needed with an unlimited daily cap if there is at least one eligible day."
          : "Could not find an extended deadline within the search window.",
    estimatedDailyLoad: Math.round(extLoad * 100) / 100,
    newDeadline: extendedDeadline ? extendedDeadline.toISOString() : null,
    feasible: extendFeasible,
  });

  if (!isBehind) {
    return {
      isBehind: false,
      completedUnits,
      expectedUnitsByToday,
      remainingUnits,
      options: [],
    };
  }

  return {
    isBehind: true,
    completedUnits,
    expectedUnitsByToday,
    remainingUnits,
    options,
  };
}

function assertStrategy(s) {
  if (!STRATEGIES.includes(s)) {
    throw new PlanInputError(`Invalid strategy: ${s}`);
  }
}

module.exports = {
  STRATEGIES,
  parseTrailingUnitRange,
  computeExpectedUnitsByToday,
  earliestDeadlineFitting,
  buildRebalancePreview,
  assertStrategy,
};
