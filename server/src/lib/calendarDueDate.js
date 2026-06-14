/**
 * Goal plans and rebalances store due dates at UTC midnight for each calendar day.
 * Display and filtering must use the UTC calendar date, not the viewer's local date.
 */

function isUtcMidnightDueDate(dateLike) {
  if (!dateLike) return false;
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return false;
  return (
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  );
}

function utcCalendarDayKey(dateLike) {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function localCalendarDayKey(dateLike, tzOffsetMinutes = 0) {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;
  const shifted = new Date(d.getTime() - Number(tzOffsetMinutes || 0) * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function taskDueCalendarDayKey(task, tzOffsetMinutes = 0) {
  if (!task?.dueDate) return null;
  if (isUtcMidnightDueDate(task.dueDate)) {
    return utcCalendarDayKey(task.dueDate);
  }
  return localCalendarDayKey(task.dueDate, tzOffsetMinutes);
}

function calendarDayKeyFromQueryInstant(instant, tzOffsetMinutes = 0) {
  if (!instant) return null;
  return localCalendarDayKey(instant, tzOffsetMinutes);
}

/**
 * Whether a task due date falls in [startDay, endDay] (inclusive) by calendar day.
 * Overdue = calendar day strictly before startDay.
 */
function taskMatchesDueDateQuery(
  task,
  { startDate, endDate, includeOverdue, tzOffsetMinutes = 0 }
) {
  if (!task?.dueDate) return false;

  const dueKey = taskDueCalendarDayKey(task, tzOffsetMinutes);
  if (!dueKey) return false;

  const startKey = startDate
    ? calendarDayKeyFromQueryInstant(startDate, tzOffsetMinutes)
    : null;
  const endKey = endDate
    ? calendarDayKeyFromQueryInstant(endDate, tzOffsetMinutes)
    : null;

  if (includeOverdue && startKey && dueKey < startKey) {
    return true;
  }

  if (startKey && dueKey < startKey) return false;
  if (endKey && dueKey > endKey) return false;
  return true;
}

module.exports = {
  isUtcMidnightDueDate,
  utcCalendarDayKey,
  localCalendarDayKey,
  taskDueCalendarDayKey,
  taskMatchesDueDateQuery,
};
