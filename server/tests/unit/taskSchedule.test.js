const {
  validateTaskScheduleFields,
  hasScheduleValue,
} = require("../../src/lib/taskSchedule");

describe("taskSchedule", () => {
  test("allows both times omitted", () => {
    expect(validateTaskScheduleFields({})).toEqual({ ok: true });
    expect(validateTaskScheduleFields({ startTime: null, endTime: null })).toEqual({
      ok: true,
    });
  });

  test("rejects only startTime", () => {
    const result = validateTaskScheduleFields({
      startTime: "2026-06-18T14:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/both be set/);
  });

  test("rejects end before start", () => {
    const result = validateTaskScheduleFields({
      startTime: "2026-06-18T15:00:00.000Z",
      endTime: "2026-06-18T14:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/later than startTime/);
  });

  test("accepts valid range", () => {
    const result = validateTaskScheduleFields({
      startTime: "2026-06-18T14:00:00.000Z",
      endTime: "2026-06-18T15:00:00.000Z",
    });
    expect(result).toEqual({ ok: true });
  });

  test("hasScheduleValue treats empty string as absent", () => {
    expect(hasScheduleValue("")).toBe(false);
    expect(hasScheduleValue(null)).toBe(false);
    expect(hasScheduleValue("2026-06-18T14:00:00.000Z")).toBe(true);
  });
});
