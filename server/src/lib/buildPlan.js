class PlanInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "PlanInputError";
  }
}

const PLAN_CAPACITY_ERROR =
  "Goal cannot be completed within the deadline given your daily limit";

const DAY_CODES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const ALL_AVAILABLE_DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

function startOfDay(d) {
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) {
    throw new PlanInputError("Invalid date");
  }
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function daysBetweenInclusive(start, end) {
  const msPerDay = 24 * 60 * 60 * 1000;
  const s = startOfDay(start).getTime();
  const e = startOfDay(end).getTime();
  return Math.floor((e - s) / msPerDay) + 1;
}

function normalizeAvailableDays(availableDays) {
  if (!Array.isArray(availableDays) || availableDays.length === 0) {
    return ALL_AVAILABLE_DAYS;
  }

  const normalized = Array.from(
    new Set(
      availableDays
        .map((d) => String(d || "").trim().toUpperCase())
        .filter((d) => DAY_CODES.includes(d))
    )
  );

  return normalized.length > 0 ? normalized : ALL_AVAILABLE_DAYS;
}

function dayCodeOf(dateLike) {
  const d = startOfDay(dateLike);
  return DAY_CODES[d.getUTCDay()];
}

function getEligibleDates({ startDate, deadline, availableDays }) {
  const start = startOfDay(startDate);
  const end = startOfDay(deadline);
  const allowed = new Set(normalizeAvailableDays(availableDays));
  const dates = [];

  for (let t = start.getTime(); t <= end.getTime(); t += 24 * 60 * 60 * 1000) {
    const day = new Date(t);
    if (allowed.has(dayCodeOf(day))) {
      dates.push(startOfDay(day));
    }
  }

  return dates;
}

/**
 * @returns {number | null} positive integer cap, or null when unlimited
 */
function resolveMaxUnitsPerDay(maxUnitsPerDay) {
  if (maxUnitsPerDay == null) return null;
  const n = Number(maxUnitsPerDay);
  if (!Number.isFinite(n) || n < 1) {
    throw new PlanInputError("maxUnitsPerDay must be a positive integer");
  }
  return Math.floor(n);
}

const AT_RISK_FRACTION = 0.8;

/**
 * Deadline risk from average load vs daily cap (deterministic).
 * @param {number} totalUnits
 * @param {number} eligibleDays
 * @param {number | null} maxUnitsPerDay — null = unlimited
 * @returns {{ riskLevel: 'on_track' | 'at_risk' | 'impossible', requiredUnitsPerDay: number, eligibleDays: number }}
 */
function computeDeadlineRisk(totalUnits, eligibleDays, maxUnitsPerDay) {
  if (!Number.isFinite(totalUnits) || totalUnits <= 0) {
    throw new PlanInputError("totalUnits must be > 0 for risk scoring");
  }
  if (!Number.isFinite(eligibleDays) || eligibleDays <= 0) {
    throw new PlanInputError("eligibleDays must be > 0 for risk scoring");
  }

  const requiredUnitsPerDay = totalUnits / eligibleDays;

  if (maxUnitsPerDay == null) {
    return {
      riskLevel: "on_track",
      requiredUnitsPerDay,
      eligibleDays,
    };
  }

  if (requiredUnitsPerDay > maxUnitsPerDay) {
    return {
      riskLevel: "impossible",
      requiredUnitsPerDay,
      eligibleDays,
    };
  }

  if (requiredUnitsPerDay >= AT_RISK_FRACTION * maxUnitsPerDay) {
    return {
      riskLevel: "at_risk",
      requiredUnitsPerDay,
      eligibleDays,
    };
  }

  return {
    riskLevel: "on_track",
    requiredUnitsPerDay,
    eligibleDays,
  };
}

/**
 * Given ideal day index per unit, assign units to days without exceeding `cap` per day.
 * Deterministic: for each unit in order, place on first day >= ideal with space, else scan backward.
 */
function assignDaysWithCap(unitToDay, days, cap) {
  const totalUnits = unitToDay.length;
  if (totalUnits > days * cap) {
    throw new PlanInputError(PLAN_CAPACITY_ERROR);
  }
  const counts = Array(days).fill(0);
  const assigned = new Array(totalUnits);
  for (let u = 0; u < totalUnits; u++) {
    const ideal = unitToDay[u];
    let placed = false;
    for (let d = ideal; d < days; d++) {
      if (counts[d] < cap) {
        counts[d]++;
        assigned[u] = d;
        placed = true;
        break;
      }
    }
    if (!placed) {
      for (let d = ideal - 1; d >= 0; d--) {
        if (counts[d] < cap) {
          counts[d]++;
          assigned[u] = d;
          placed = true;
          break;
        }
      }
    }
    if (!placed) {
      throw new PlanInputError(PLAN_CAPACITY_ERROR);
    }
  }
  return assigned;
}

function buildPlan({
  totalUnits,
  unitName,
  startDate,
  deadline,
  availableDays,
  maxUnitsPerDay,
  weights,
  unitStartAt = 1,
}) {
  if (!Number.isFinite(totalUnits) || totalUnits <= 0) {
    throw new PlanInputError("Total units must be > 0");
  }

  const eligibleDates = getEligibleDates({ startDate, deadline, availableDays });
  const days = eligibleDates.length;
  if (days <= 0) {
    throw new PlanInputError(
      "No eligible study days between start date and deadline. Choose available days that include at least one date in range."
    );
  }

  // Normalize weights into an array of length totalUnits.
  const normalizedWeights =
    Array.isArray(weights) && weights.length === totalUnits
      ? weights.map((w) => {
          const n = Number(w);
          return Number.isFinite(n) && n > 0 ? n : 1;
        })
      : Array.from({ length: totalUnits }, () => 1);

  const totalWeight = normalizedWeights.reduce((sum, w) => sum + w, 0) || 1;

  // Assign each unit to an eligible day index [0..days-1], based on weight span center.
  const unitToDay = new Array(totalUnits).fill(0);
  let prefixWeightBefore = 0;
  for (let u = 0; u < totalUnits; u++) {
    if (u === totalUnits - 1) {
      unitToDay[u] = days - 1; // ensure deadline day always has content
    } else {
      const w = normalizedWeights[u];
      const midRatio = (prefixWeightBefore + w / 2) / totalWeight;
      const dayIdx = Math.round(midRatio * (days - 1));
      unitToDay[u] = Math.max(0, Math.min(days - 1, dayIdx));
    }
    prefixWeightBefore += normalizedWeights[u];
  }

  const cap = resolveMaxUnitsPerDay(maxUnitsPerDay);
  const dayAssignments =
    cap == null ? unitToDay : assignDaysWithCap(unitToDay, days, cap);

  // Group consecutive units that map to the same day.
  const items = [];
  let groupStart = 0;
  let groupDay = dayAssignments[0];

  const pushGroup = (endExclusive) => {
    const startUnitIdx = groupStart;
    const endUnitIdx = endExclusive - 1;

    const startUnit = unitStartAt + startUnitIdx;
    const endUnit = unitStartAt + endUnitIdx;
    const unitsPlanned = endUnit - startUnit + 1;

    const title =
      unitsPlanned === 1
        ? `${unitName} ${startUnit}`
        : `${unitName} ${startUnit}-${endUnit}`;

    const dueDate = eligibleDates[groupDay];

    items.push({
      dueDate: dueDate.toISOString(),
      title,
      unitsPlanned,
      unitRange: { start: startUnit, end: endUnit },
    });
  };

  for (let u = 1; u < totalUnits; u++) {
    if (dayAssignments[u] !== groupDay) {
      pushGroup(u);
      groupStart = u;
      groupDay = dayAssignments[u];
    }
  }
  pushGroup(totalUnits);

  const deadlineRisk = computeDeadlineRisk(totalUnits, days, cap);

  return {
    days,
    perDay: deadlineRisk.requiredUnitsPerDay,
    items,
    maxUnitsPerDay: cap,
    riskLevel: deadlineRisk.riskLevel,
    requiredUnitsPerDay: deadlineRisk.requiredUnitsPerDay,
    eligibleDays: deadlineRisk.eligibleDays,
  };
}

module.exports = {
  ALL_AVAILABLE_DAYS,
  AT_RISK_FRACTION,
  PLAN_CAPACITY_ERROR,
  PlanInputError,
  daysBetweenInclusive,
  dayCodeOf,
  buildPlan,
  computeDeadlineRisk,
  getEligibleDates,
  normalizeAvailableDays,
  resolveMaxUnitsPerDay,
  startOfDay,
};
