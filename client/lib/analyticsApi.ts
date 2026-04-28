import { api } from "@/lib/api";
import type { AnalyticsInterval, ProductivityPeriodMetrics } from "@/lib/productivityScore";

/** Raw payload from GET /analytics/dashboard */
export type AnalyticsDashboardDto = {
  interval: AnalyticsInterval;
  heroTitle: string;
  compareLabel: string;
  current: ProductivityPeriodMetrics;
  previous: ProductivityPeriodMetrics;
  trendBars: number[];
  loadBars: number[];
  completeBars: number[];
  windows?: {
    current: { start: string; end: string };
    previous: { start: string; end: string };
  };
};

export async function fetchAnalyticsDashboard(
  interval: AnalyticsInterval
): Promise<AnalyticsDashboardDto> {
  const tzOffsetMinutes = new Date().getTimezoneOffset();
  return api(
    `/analytics/dashboard?interval=${encodeURIComponent(interval)}&tzOffsetMinutes=${tzOffsetMinutes}`
  );
}
