/**
 * Maps API DTOs into the analytics UI model (presentation layer only).
 * Keeps pages free of raw response shaping.
 */

import type { AnalyticsInterval } from "@/lib/productivityScore";
import { compareProductivityScores } from "@/lib/productivityScore";
import { deriveInsights } from "@/lib/analyticsInsights";
import type { AnalyticsDashboardDto } from "@/lib/analyticsApi";
import type { AnalyticsSlice } from "@/lib/analyticsTypes";

export function dashboardDtoToAnalyticsSlice(
  dto: AnalyticsDashboardDto,
  interval: AnalyticsInterval
): AnalyticsSlice {
  const comparison = compareProductivityScores(
    interval,
    dto.current,
    dto.previous
  );
  const insightInput = {
    interval,
    current: dto.current,
    previous: dto.previous,
    trendBars: dto.trendBars,
    loadBars: dto.loadBars,
    completeBars: dto.completeBars,
    currentScore: comparison.currentScore,
    scoreDelta: comparison.scoreDelta,
  };
  const { headline } = deriveInsights(insightInput);

  return {
    heroTitle: dto.heroTitle,
    compareLabel: dto.compareLabel,
    insight: headline,
    current: dto.current,
    previous: dto.previous,
    trendBars: dto.trendBars,
    loadBars: dto.loadBars,
    completeBars: dto.completeBars,
  };
}
