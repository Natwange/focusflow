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
 * @param {number} tzOffsetMinutes
 * @param {Date} [now]
 * @returns {Date}
 */
function getLocalReferenceDate(tzOffsetMinutes = 0, now = new Date()) {
  const tz = Number(tzOffsetMinutes) || 0;
  const localMs = now.getTime() - tz * 60 * 1000;
  return new Date(localMs);
}

/**
 * @param {number} tzOffsetMinutes
 * @param {Date} [now]
 * @returns {Date}
 */
function getLocalTodayStart(tzOffsetMinutes = 0, now = new Date()) {
  const local = getLocalReferenceDate(tzOffsetMinutes, now);
  return startOfDay(
    new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()))
  );
}

/**
 * @param {string} key
 * @returns {number|undefined}
 */
function monthIndex(key) {
  return MONTHS[String(key || "").trim().toLowerCase()];
}

/**
 * @param {string} monthKey
 * @param {string|number} day
 * @param {string|number|undefined} yearStr
 * @param {Date} local
 * @returns {string|null}
 */
function tryNamedMonthDay(monthKey, day, yearStr, local) {
  const month = monthIndex(monthKey);
  if (month === undefined) return null;

  const dayNum = Number(String(day).replace(/(?:st|nd|rd|th)$/i, ""));
  if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > 31) return null;

  let year = yearStr != null && yearStr !== "" ? Number(yearStr) : local.getUTCFullYear();
  if (!Number.isFinite(year)) return null;

  let candidate = new Date(Date.UTC(year, month, dayNum));
  if (Number.isNaN(candidate.getTime())) return null;

  const todayStart = startOfDay(
    new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()))
  );

  if (!yearStr && candidate.getTime() < todayStart.getTime()) {
    year += 1;
    candidate = new Date(Date.UTC(year, month, dayNum));
    if (Number.isNaN(candidate.getTime())) return null;
  }

  return startOfDay(candidate).toISOString();
}

/**
 * @param {string} lower
 * @param {Date} local
 * @returns {string|null}
 */
function findNamedDateInText(lower, local) {
  const attempts = [
    // extend to July 10th, by July 10, until July 10, 2026
    {
      re: /(?:\b(?:to|by|until|on|for)\s+)([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?\b/gi,
      map: (m) => [m[1], m[2], m[3]],
    },
    // July 10, July 10th, July 10 2026
    {
      re: /\b([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?\b/gi,
      map: (m) => [m[1], m[2], m[3]],
    },
    // 10 July, 10th of July 2026
    {
      re: /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]+)(?:\s*,?\s*(\d{4}))?\b/gi,
      map: (m) => [m[2], m[1], m[3]],
    },
  ];

  for (const { re, map } of attempts) {
    for (const match of lower.matchAll(re)) {
      const [monthKey, day, yearStr] = map(match);
      const iso = tryNamedMonthDay(monthKey, day, yearStr, local);
      if (iso) return iso;
    }
  }

  return null;
}

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
  const local = getLocalReferenceDate(tzOffsetMinutes, now);

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

  const isoBare = raw.match(/^(\d{4}-\d{2}-\d{2})(?:T.*)?$/);
  if (isoBare) {
    const parsed = Date.parse(isoBare[1]);
    if (Number.isNaN(parsed)) throw new PlanInputError("Invalid deadline date");
    return startOfDay(new Date(parsed)).toISOString();
  }

  const byIso = lower.match(/\bby\s+(\d{4}-\d{2}-\d{2})\b/);
  if (byIso) {
    const parsed = Date.parse(byIso[1]);
    if (Number.isNaN(parsed)) throw new PlanInputError("Invalid deadline date");
    return startOfDay(new Date(parsed)).toISOString();
  }

  const byNamed = lower.match(
    /\bby\s+([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?\b/
  );
  if (byNamed) {
    const iso = tryNamedMonthDay(byNamed[1], byNamed[2], byNamed[3], local);
    if (iso) return iso;
    throw new PlanInputError("Unrecognized month in deadline");
  }

  const named = findNamedDateInText(lower, local);
  if (named) return named;

  // Only accept unambiguous ISO-like strings from Date.parse — not bare "July 10".
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(raw)) {
    const direct = Date.parse(raw);
    if (!Number.isNaN(direct)) {
      return startOfDay(new Date(direct)).toISOString();
    }
  }

  throw new PlanInputError(
    "Invalid deadline. Try natural phrases like \"July 10\", \"July 10th\", \"by June 1\", \"in 2 weeks\", or ISO \"2026-07-10\"."
  );
}

module.exports = {
  parseGoalDeadline,
  getLocalTodayStart,
  getLocalReferenceDate,
};
