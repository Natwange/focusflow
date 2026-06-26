const {
  isRescheduleDateFollowUp,
  findRescheduleContext,
  buildRescheduleUpdateArgs,
  localDateTimeToUtcIso,
} = require("../../src/agent/ruleParser");
const { localKeyFromUtcDate } = require("../../src/lib/focusSummary");

describe("reschedule follow-up", () => {
  const tzOffsetMinutes = 300; // US Eastern (UTC-5): getTimezoneOffset returns +300
  const fixedNow = new Date("2026-06-24T18:00:00.000Z");

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(fixedNow);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("detects today as a reschedule date follow-up", () => {
    expect(isRescheduleDateFollowUp("Today")).toBe(true);
    expect(isRescheduleDateFollowUp("tomorrow")).toBe(true);
    expect(isRescheduleDateFollowUp("reschedule my task")).toBe(false);
  });

  it("finds task title from assistant reschedule clarification", () => {
    const history = [
      { role: "user", text: "reschedule apply for 5 internships" },
      {
        role: "assistant",
        text:
          "I'll help you reschedule 'Apply to 5 internships.' When would you like to move this task to?",
      },
    ];
    expect(findRescheduleContext(history)).toEqual({
      taskTitle: "Apply to 5 internships",
    });
  });

  it("builds due date for today in user local timezone", () => {
    const todayKey = localKeyFromUtcDate(fixedNow, tzOffsetMinutes);
    expect(todayKey).toBe("2026-06-24");

    const updates = buildRescheduleUpdateArgs("today", tzOffsetMinutes, {
      dueDate: new Date("2026-06-26T14:00:00.000Z"),
      startTime: null,
      endTime: null,
    });

    expect(updates.dueDate).toBe(
      localDateTimeToUtcIso({
        dayOffset: 0,
        hour: 9,
        minute: 0,
        tzOffsetMinutes,
        now: fixedNow,
      })
    );
    expect(updates.dueDate).not.toMatch(/2026-06-26/);
  });
});
