import type { ProductivityPeriodMetrics } from "@/lib/productivityScore";

/** Canonical shape consumed by Analytics UI and insights. */
export type AnalyticsSlice = {
  heroTitle: string;
  compareLabel: string;
  insight: string;
  current: ProductivityPeriodMetrics;
  previous: ProductivityPeriodMetrics;
  trendBars: number[];
  loadBars: number[];
  completeBars: number[];
};
