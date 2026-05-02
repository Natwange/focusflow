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

/** Payload from GET /analytics/activity-patterns (userActivityPatternAnalyzer). */
export type ActivityPatternsDto = {
  windowDays: number;
  generatedAt: string;
  lowData: boolean;
  weekdayStats: Array<{
    weekday: string;
    totalTasks: number;
    completedTasks: number;
    missedTasks: number;
    completionRate: number;
    focusSessions: number;
    focusMinutes: number;
    goalsTouched: number;
    agentRecommendationsAccepted: number;
  }>;
  bestDays: string[];
  weakDays: string[];
  consistencySignals: {
    currentStreak: number;
    longestStreak: number;
    activeDays: number;
    inactiveDays: number;
  };
  focusSignals: {
    totalFocusMinutes: number;
    averageFocusMinutesPerActiveDay: number;
    bestFocusDay: string | null;
    weakestFocusDay: string | null;
  };
  taskSignals: {
    totalTasks: number;
    completedTasks: number;
    missedTasks: number;
    completionRate: number;
  };
  agentSignals: {
    totalRecommendations: number;
    acceptedRecommendations: number;
    acceptanceRate: number;
  };
  summary: string;
};

export async function fetchActivityPatterns(
  days = 90
): Promise<ActivityPatternsDto> {
  return api(
    `/analytics/activity-patterns?days=${encodeURIComponent(String(days))}`
  );
}
