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
