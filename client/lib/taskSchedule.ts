export type TaskScheduleFields = {
  startTime?: string | null;
  endTime?: string | null;
};

export const DAY_TIMELINE_HOUR_HEIGHT_PX = 48;

export function isTaskScheduled(task: TaskScheduleFields): boolean {
  return Boolean(task.startTime && task.endTime);
}

export function combineLocalDateAndTime(date: string, time: string): string {
  return new Date(`${date}T${time}`).toISOString();
}

/** Validate optional start/end on a calendar date (HH:mm local). */
export function validateScheduleOnDate(
  date: string,
  startTime: string,
  endTime: string
): string | null {
  if (!startTime && !endTime) return null;
  if (!startTime || !endTime) {
    return "Provide both start and end times, or leave both empty.";
  }
  if (!date) {
    return "Choose a due date when scheduling a time block.";
  }
  const start = new Date(`${date}T${startTime}`);
  const end = new Date(`${date}T${endTime}`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return "Invalid start or end time.";
  }
  if (end <= start) {
    return "End time must be after start time.";
  }
  return null;
}

export function buildSchedulePayload(
  date: string,
  startTime: string,
  endTime: string
): { dueDate: string; startTime: string; endTime: string } | null {
  if (!startTime || !endTime) return null;
  const startIso = combineLocalDateAndTime(date, startTime);
  const endIso = combineLocalDateAndTime(date, endTime);
  return { dueDate: startIso, startTime: startIso, endTime: endIso };
}

export function formatScheduleRange(startTime: string, endTime: string): string {
  const s = new Date(startTime);
  const e = new Date(endTime);
  const opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  return `${s.toLocaleTimeString(undefined, opts)} – ${e.toLocaleTimeString(undefined, opts)}`;
}

export function minutesFromMidnightLocal(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

/** Minutes since local midnight for the current moment (includes seconds for sub-hour precision). */
export function minutesFromMidnightNow(date = new Date()): number {
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}

export function timelineTopPxForMinutes(
  minutes: number,
  hourHeightPx = DAY_TIMELINE_HOUR_HEIGHT_PX
): number {
  return (minutes / 60) * hourHeightPx;
}

export function parseScheduleTimes(
  startTime: string | null | undefined,
  endTime: string | null | undefined
): { start: string; end: string } {
  if (!startTime || !endTime) return { start: "", end: "" };
  const s = new Date(startTime);
  const e = new Date(endTime);
  const fmt = (d: Date) =>
    `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return { start: fmt(s), end: fmt(e) };
}

export function formatHourLabel(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return "12 PM";
  return `${hour - 12} PM`;
}
