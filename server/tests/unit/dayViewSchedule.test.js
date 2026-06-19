/**
 * Day view classification mirrors client/components/tasks/DayTimeline.tsx
 */
const {
  isUtcMidnightDueDate,
  utcCalendarDayKey,
  localCalendarDayKey,
} = require("../../src/lib/calendarDueDate");

function taskDueCalendarDayKey(iso) {
  if (!iso) return null;
  return isUtcMidnightDueDate(iso) ? utcCalendarDayKey(iso) : localCalendarDayKey(iso);
}

function taskBelongsOnDay(task, dayKey) {
  const anchor = task.dueDate || task.startTime;
  if (!anchor) return false;
  return taskDueCalendarDayKey(anchor) === dayKey;
}

describe("day view task classification", () => {
  const dayKey = "2026-06-18";

  test("scheduled task belongs on its due day", () => {
    const task = {
      dueDate: "2026-06-18T14:00:00.000Z",
      startTime: "2026-06-18T14:00:00.000Z",
      endTime: "2026-06-18T15:00:00.000Z",
    };
    expect(taskBelongsOnDay(task, dayKey)).toBe(true);
  });

  test("unscheduled task with UTC-midnight due date belongs on that day", () => {
    const task = {
      dueDate: "2026-06-18T00:00:00.000Z",
      startTime: null,
      endTime: null,
    };
    expect(taskBelongsOnDay(task, dayKey)).toBe(true);
  });

  test("separates scheduled vs unscheduled on same day", () => {
    const tasks = [
      {
        dueDate: "2026-06-18T14:00:00.000Z",
        startTime: "2026-06-18T14:00:00.000Z",
        endTime: "2026-06-18T15:00:00.000Z",
      },
      {
        dueDate: "2026-06-18T00:00:00.000Z",
        startTime: null,
        endTime: null,
      },
    ];
    const dayTasks = tasks.filter((t) => taskBelongsOnDay(t, dayKey));
    const scheduled = dayTasks.filter((t) => t.startTime && t.endTime);
    const unscheduled = dayTasks.filter((t) => !(t.startTime && t.endTime));
    expect(scheduled).toHaveLength(1);
    expect(unscheduled).toHaveLength(1);
  });
});
