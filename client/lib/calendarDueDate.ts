/**
 * Goal plan / rebalance tasks use UTC-midnight due dates (one UTC calendar day).
 * Show and group those by UTC date so they match the rebalance preview.
 */

export function isUtcMidnightDueDate(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return (
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  );
}

export function utcCalendarDayKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function localCalendarDayKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Calendar day for display / grouping (UTC for plan tasks, local otherwise). */
export function taskDueCalendarDayKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return isUtcMidnightDueDate(iso) ? utcCalendarDayKey(iso) : localCalendarDayKey(iso);
}

export function formatCalendarDueDate(iso: string): string {
  const key = taskDueCalendarDayKey(iso);
  if (!key) return "";
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatCalendarDueDateTime(iso: string): string {
  const d = new Date(iso);
  const dateLabel = formatCalendarDueDate(iso);
  if (isUtcMidnightDueDate(iso)) return dateLabel;
  const h = d.getHours();
  const m = d.getMinutes();
  if (h === 0 && m === 0) return dateLabel;
  return `${dateLabel}, ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}
