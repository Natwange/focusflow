/**
 * Fallback demo slices for the assistant when no live analytics slice is in context.
 */

import type { AnalyticsInterval } from "./productivityScore";
import type { AnalyticsSlice } from "./analyticsTypes";

/** @deprecated Prefer `AnalyticsSlice` from `analyticsTypes.ts` */
export type MockAnalyticsSlice = AnalyticsSlice;

export const MOCK_ANALYTICS_BY_INTERVAL: Record<
  AnalyticsInterval,
  AnalyticsSlice
> = {
  day: {
    heroTitle: "Today",
    compareLabel: "vs yesterday",
    insight:
      "You’re ahead of yesterday on focus and tasks finished. A short block before noon would stretch the lead.",
    current: {
      tasksCompleted: 7,
      tasksPlanned: 9,
      focusMinutes: 85,
      avgSessionMinutes: 27,
      streakDays: 4,
    },
    previous: {
      tasksCompleted: 5,
      tasksPlanned: 10,
      focusMinutes: 68,
      avgSessionMinutes: 25,
      streakDays: 3,
    },
    trendBars: [22, 35, 28, 45, 38, 52, 40],
    loadBars: [40, 38, 42, 35, 30, 28, 32],
    completeBars: [28, 30, 32, 38, 42, 45, 40],
  },
  week: {
    heroTitle: "This week",
    compareLabel: "vs last week",
    insight:
      "Slightly less focus than last week, but you still chipped away at the list. One longer session would lift the score.",
    current: {
      tasksCompleted: 28,
      tasksPlanned: 38,
      focusMinutes: 520,
      avgSessionMinutes: 25,
      streakDays: 5,
    },
    previous: {
      tasksCompleted: 30,
      tasksPlanned: 36,
      focusMinutes: 580,
      avgSessionMinutes: 24,
      streakDays: 5,
    },
    trendBars: [55, 48, 62, 58, 70, 45, 52],
    loadBars: [50, 52, 48, 55, 58, 52, 50],
    completeBars: [38, 40, 42, 45, 48, 44, 46],
  },
  month: {
    heroTitle: "This month",
    compareLabel: "vs last month",
    insight:
      "Strong month: more tasks finished and more focus than before. Keep the same weekly rhythm.",
    current: {
      tasksCompleted: 118,
      tasksPlanned: 145,
      focusMinutes: 2180,
      avgSessionMinutes: 26,
      streakDays: 12,
    },
    previous: {
      tasksCompleted: 95,
      tasksPlanned: 140,
      focusMinutes: 1850,
      avgSessionMinutes: 25,
      streakDays: 10,
    },
    trendBars: [40, 44, 48, 52, 58, 62, 68, 65, 70, 72, 75, 78],
    loadBars: [60, 58, 55, 52, 50, 48, 52, 54, 56, 58, 55, 52],
    completeBars: [45, 48, 50, 52, 55, 58, 60, 62, 64, 66, 68, 70],
  },
};
