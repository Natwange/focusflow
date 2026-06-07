const { startOfDay, PlanInputError } = require("./buildPlan");

const MONTHS = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

/**
 * Parse a goal deadline from ISO or common relative/natural phrases.
 * Returns UTC midnight ISO string for the deadline day.
 *
 * @param {string} input
 * @param {number} [tzOffsetMinutes]
 * @param {Date} [now]
 * @returns {string} ISO 8601
 */
function parseGoalDeadline(input, tzOffsetMinutes = 0, now = new Date()) {
  const raw = String(input ?? "").trim();
  if (!raw) {
    throw new PlanInputError("deadline is required");
  }

  const lower = raw.toLowerCase();
  const tz = Number(tzOffsetMinutes) || 0;
  const localMs = now.getTime() - tz * 60 * 1000;
  const local = new Date(localMs);

  const inDays = lower.match(/\bin\s+(\d+)\s+days?\b/);
  if (inDays) {
    const n = Number(inDays[1]);
    if (n < 1 || n > 3650) throw new PlanInputError("Invalid deadline range");
    const d = new Date(local);
    d.setUTCDate(d.getUTCDate() + n);
    return startOfDay(d).toISOString();
  }

  const inWeeks = lower.match(/\bin\s+(\d+)\s+weeks?\b/);
  if (inWeeks) {
    const n = Number(inWeeks[1]);
    if (n < 1 || n > 520) throw new PlanInputError("Invalid deadline range");
    const d = new Date(local);
    d.setUTCDate(d.getUTCDate() + n * 7);
    return startOfDay(d).toISOString();
  }

  const byIso = lower.match(/\bby\s+(\d{4}-\d{2}-\d{2})\b/);
  if (byIso) {
    const parsed = Date.parse(byIso[1]);
    if (Number.isNaN(parsed)) throw new PlanInputError("Invalid deadline date");
    return startOfDay(new Date(parsed)).toISOString();
  }

  const byNamed = lower.match(
    /\bby\s+([a-z]+)\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?\b/
  );
  if (byNamed) {
    const monthKey = byNamed[1];
    const month = MONTHS[monthKey];
    if (month === undefined) throw new PlanInputError("Unrecognized month in deadline");
    const day = Number(byNamed[2]);
    let year = byNamed[3] ? Number(byNamed[3]) : local.getUTCFullYear();
    const candidate = new Date(Date.UTC(year, month, day));
    if (Number.isNaN(candidate.getTime())) {
      throw new PlanInputError("Invalid deadline date");
    }
    if (!byNamed[3] && candidate.getTime() < startOfDay(local).getTime()) {
      year += 1;
    }
    const finalDate = new Date(Date.UTC(year, month, day));
    return startOfDay(finalDate).toISOString();
  }

  const direct = Date.parse(raw);
  if (!Number.isNaN(direct)) {
    return startOfDay(new Date(direct)).toISOString();
  }

  throw new PlanInputError(
    "Invalid deadline. Use ISO date, 'in 7 days', 'in 2 weeks', or 'by June 1'."
  );
}

module.exports = { parseGoalDeadline };
