/**
 * Validation for optional task startTime/endTime pairs.
 * Both null/omitted = unscheduled. Both set = scheduled block. Mixed = invalid.
 */

function hasScheduleValue(value) {
  return value !== undefined && value !== null && value !== "";
}

/**
 * @param {{ startTime?: string | null, endTime?: string | null }} fields
 * @returns {{ ok: true } | { ok: false, error: string, field?: string }}
 */
function validateTaskScheduleFields({ startTime, endTime }) {
  const hasStart = hasScheduleValue(startTime);
  const hasEnd = hasScheduleValue(endTime);

  if (hasStart !== hasEnd) {
    return {
      ok: false,
      error: "startTime and endTime must both be set or both omitted",
      field: hasStart ? "endTime" : "startTime",
    };
  }

  if (!hasStart) {
    return { ok: true };
  }

  const startMs = Date.parse(String(startTime));
  const endMs = Date.parse(String(endTime));
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return { ok: false, error: "Invalid startTime or endTime", field: "startTime" };
  }
  if (endMs <= startMs) {
    return {
      ok: false,
      error: "endTime must be later than startTime",
      field: "endTime",
    };
  }

  return { ok: true };
}

/**
 * Zod superRefine helper for task create/update bodies.
 */
function refineTaskSchedule(data, ctx) {
  const result = validateTaskScheduleFields(data);
  if (!result.ok) {
    ctx.addIssue({
      code: "custom",
      message: result.error,
      path: result.field ? [result.field] : ["endTime"],
    });
  }
}

/**
 * @param {Date | string | null | undefined} value
 * @returns {Date | null}
 */
function parseOptionalScheduleDate(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  return new Date(value);
}

module.exports = {
  validateTaskScheduleFields,
  refineTaskSchedule,
  parseOptionalScheduleDate,
  hasScheduleValue,
};
