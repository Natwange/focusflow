class PlanInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "PlanInputError";
  }
}

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

function buildPlan({
  totalUnits,
  unitName,
  startDate,
  deadline,
  weights,
  unitStartAt = 1,
}) {
  if (!Number.isFinite(totalUnits) || totalUnits <= 0) {
    throw new PlanInputError("Total units must be > 0");
  }

  const days = daysBetweenInclusive(startDate, deadline);
  if (days <= 0) {
    throw new PlanInputError("Deadline must be in the future");
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

  // Assign each unit to a day index [0..days-1], based on weight span center.
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

  // Group consecutive units that map to the same day.
  const items = [];
  let groupStart = 0;
  let groupDay = unitToDay[0];

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

    const dueDate = startOfDay(
      new Date(startOfDay(startDate).getTime() + groupDay * 24 * 60 * 60 * 1000)
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

  return { days, perDay: totalUnits / days, items };
}

module.exports = {
  PlanInputError,
  startOfDay,
  daysBetweenInclusive,
  buildPlan,
};
