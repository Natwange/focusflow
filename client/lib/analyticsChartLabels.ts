import type { AnalyticsInterval } from "@/lib/productivityScore";

/** Sparse, calm range labels under charts (avoid per-bar clutter). */
export function trendRangeLabels(interval: AnalyticsInterval): {
  start: string;
  mid: string;
  end: string;
} {
  switch (interval) {
    case "day":
      return { start: "Morning", mid: "Midday", end: "Evening" };
    case "week":
      return { start: "Mon", mid: "Wed", end: "Sun" };
    case "month":
      return { start: "Early", mid: "Mid", end: "Late" };
  }
}

const DAY_TIME_SLOTS = [
  "Early morning",
  "Late morning",
  "Midday",
  "Afternoon",
  "Late afternoon",
  "Evening",
  "Night",
] as const;

/** One label per chart bucket (matches API bar order). */
export function trendBucketLabels(
  interval: AnalyticsInterval,
  count: number
): string[] {
  if (count <= 0) return [];

  if (interval === "day") {
    if (count === DAY_TIME_SLOTS.length) {
      return [...DAY_TIME_SLOTS];
    }
    return Array.from({ length: count }, (_, i) => {
      const t = count <= 1 ? 0 : i / (count - 1);
      const idx = Math.min(
        DAY_TIME_SLOTS.length - 1,
        Math.round(t * (DAY_TIME_SLOTS.length - 1))
      );
      return DAY_TIME_SLOTS[idx]!;
    });
  }

  if (interval === "week") {
    return Array.from({ length: count }, (_, i) => {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() - (count - 1 - i));
      const weekday = d.toLocaleDateString(undefined, { weekday: "short" });
      const day = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      return `${weekday} · ${day}`;
    });
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthShort = now.toLocaleDateString(undefined, { month: "short" });

  return Array.from({ length: count }, (_, i) => {
    const startDay = Math.floor((i * daysInMonth) / count) + 1;
    const endDay = Math.floor(((i + 1) * daysInMonth) / count);
    if (startDay >= endDay) return `${monthShort} ${startDay}`;
    return `${monthShort} ${startDay}–${endDay}`;
  });
}
