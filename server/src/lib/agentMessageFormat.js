const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function utcIsoToLocalParts(iso, tzOffsetMinutes) {
  const tz = Number(tzOffsetMinutes) || 0;
  const localMs = Date.parse(String(iso)) - tz * 60 * 1000;
  const d = new Date(localMs);
  return {
    month: MONTH_NAMES[d.getUTCMonth()],
    day: d.getUTCDate(),
    year: d.getUTCFullYear(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

function formatTime12h(hour, minute) {
  const h = hour % 12 || 12;
  const m = String(minute).padStart(2, "0");
  const ampm = hour < 12 ? "AM" : "PM";
  return `${h}:${m} ${ampm}`;
}

function formatLocalDate(iso, tzOffsetMinutes) {
  const { month, day, year } = utcIsoToLocalParts(iso, tzOffsetMinutes);
  return `${month} ${day}, ${year}`;
}

function formatLocalDateTime(iso, tzOffsetMinutes) {
  const { month, day, year, hour, minute } = utcIsoToLocalParts(iso, tzOffsetMinutes);
  return `${month} ${day}, ${year} at ${formatTime12h(hour, minute)}`;
}

function formatLocalTimeRange(startIso, endIso, tzOffsetMinutes) {
  const start = utcIsoToLocalParts(startIso, tzOffsetMinutes);
  const end = utcIsoToLocalParts(endIso, tzOffsetMinutes);
  const sameDay =
    start.year === end.year && start.month === end.month && start.day === end.day;

  if (sameDay) {
    return `${start.month} ${start.day} from ${formatTime12h(start.hour, start.minute)} to ${formatTime12h(end.hour, end.minute)}`;
  }

  return `${formatLocalDateTime(startIso, tzOffsetMinutes)} to ${formatLocalDateTime(endIso, tzOffsetMinutes)}`;
}

function formatCreatedTaskSummary(task, tzOffsetMinutes = 0) {
  const title = task.title;
  if (task.startTime && task.endTime) {
    return `Created task "${title}" for ${formatLocalTimeRange(task.startTime, task.endTime, tzOffsetMinutes)}.`;
  }
  if (task.dueDate) {
    return `Created task "${title}" for ${formatLocalDateTime(task.dueDate, tzOffsetMinutes)}.`;
  }
  return `Created task "${title}" with no due date.`;
}

function formatUpdatedScheduleSummary(startIso, endIso, tzOffsetMinutes = 0) {
  return formatLocalTimeRange(startIso, endIso, tzOffsetMinutes);
}

module.exports = {
  formatCreatedTaskSummary,
  formatLocalDateTime,
  formatLocalTimeRange,
  formatUpdatedScheduleSummary,
};
