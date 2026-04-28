/**
 * Rule-based assistant replies from mock analytics.
 * Swap this module for an API/LLM adapter later; keep the same export shape.
 */

import type { AnalyticsInterval } from "../productivityScore";
import { compareProductivityScores, tasksCompletionRate } from "../productivityScore";
import {
  detectOverloadPattern,
  deriveInsights,
  deriveRecommendations,
  type AnalyticsInsightInput,
} from "../analyticsInsights";
import { MOCK_ANALYTICS_BY_INTERVAL } from "../mockAnalytics";
import type { AnalyticsSlice } from "../analyticsTypes";

export type RuleBasedAnalyticsOptions = {
  /** From chat context; defaults to week when unset (e.g. user never opened Analytics). */
  interval?: AnalyticsInterval;
  /** Live slice from Analytics; otherwise demo fallback for the chosen interval. */
  slice?: AnalyticsSlice | null;
};

function buildInsightInput(
  interval: AnalyticsInterval,
  slice: AnalyticsSlice
): AnalyticsInsightInput {
  const { currentScore, scoreDelta } = compareProductivityScores(
    interval,
    slice.current,
    slice.previous
  );
  return {
    interval,
    current: slice.current,
    previous: slice.previous,
    trendBars: slice.trendBars,
    loadBars: slice.loadBars,
    completeBars: slice.completeBars,
    currentScore,
    scoreDelta,
  };
}

function indexOfMax(values: number[]): number {
  if (values.length === 0) return 0;
  let best = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i]! > values[best]!) best = i;
  }
  return best;
}

function peakDayName(trendBars: number[]): string {
  const i = indexOfMax(trendBars);
  const days = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ];
  return days[Math.min(i, days.length - 1)] ?? "one day";
}

function peakTimeOfDay(trendBars: number[]): string {
  const i = indexOfMax(trendBars);
  const slots = [
    "early in the day",
    "late morning",
    "around midday",
    "early afternoon",
    "late afternoon",
    "early evening",
    "later on",
  ];
  return slots[Math.min(i, slots.length - 1)] ?? "midday";
}

function peakMonthPhase(trendBars: number[]): string {
  const i = indexOfMax(trendBars);
  const n = trendBars.length;
  const t = n <= 1 ? 0.5 : i / (n - 1);
  if (t < 0.34) return "earlier in the month";
  if (t < 0.67) return "mid-month";
  return "toward the end of the month";
}

function periodPhrase(interval: AnalyticsInterval): string {
  if (interval === "day") return "today’s snapshot";
  if (interval === "week") return "this week’s trend";
  return "this month’s trend";
}

function matchesOverload(q: string): boolean {
  return (
    /\boverload|overwhelmed|too much (on my plate|to do)|spread too thin|burning out\b/i.test(
      q
    ) ||
    (/\btoo many\b/i.test(q) && /\btask/i.test(q)) ||
    /\bam i (overloaded|taking on too much)\b/i.test(q)
  );
}

function matchesProductiveDays(q: string): boolean {
  return (
    /\bwhich day/i.test(q) ||
    /\b(most|best) productive day/i.test(q) ||
    (/\bproductive\b/i.test(q) && /\bday\b/i.test(q) && /\bwhich|what|when\b/i.test(q))
  );
}

function matchesWhenFocused(q: string): boolean {
  return (
    /\bwhen (am i|should i|do i) (most )?focus/i.test(q) ||
    (/\bwhen should\b/i.test(q) &&
      /\bfocus|session|block|deep work|productive/i.test(q)) ||
    /\bmost focused\b/i.test(q) ||
    /\bschedule focus\b/i.test(q) ||
    /\bfocus session/i.test(q)
  );
}

function matchesImprove(q: string): boolean {
  return (
    (/\b(improve|boost|increase)\b/i.test(q) && /\bproductiv/i.test(q)) ||
    /\bwhat do i need to do\b/i.test(q) ||
    /\bhow can i (get better|improve)\b/i.test(q)
  );
}

function replyOverload(interval: AnalyticsInterval, input: AnalyticsInsightInput): string {
  const heavy = detectOverloadPattern(input);
  const rate = tasksCompletionRate(input.current);
  const p = periodPhrase(interval);
  if (heavy) {
    return `From ${p}, it looks a bit heavy: planned work is outpacing what’s getting closed. Try dropping two non-urgent tasks and guarding one uninterrupted focus block.`;
  }
  return `From ${p}, you’re finishing about ${Math.round(rate * 100)}% of what you planned—not a red flag in the data. If it still feels like too much, the list may be bigger than the numbers capture.`;
}

function replyProductiveDays(interval: AnalyticsInterval, slice: AnalyticsSlice): string {
  const bars = slice.trendBars;
  if (bars.length === 0) {
    return "I don’t have enough trend data in this range to call out a best day yet.";
  }
  if (interval === "week") {
    return `In this week view, ${peakDayName(bars)} shows the highest bump—that’s a strong anchor for harder work.`;
  }
  if (interval === "day") {
    return `For today’s chart, you’re strongest ${peakTimeOfDay(bars)}. That’s the best window to protect for deep work.`;
  }
  return `Across this month’s chart, energy peaks ${peakMonthPhase(bars)}—mirror that rhythm next month if it felt good.`;
}

function replyWhenFocused(interval: AnalyticsInterval, slice: AnalyticsSlice): string {
  const bars = slice.trendBars;
  if (bars.length === 0) {
    return "I’d need more points on the trend to suggest a focus window.";
  }
  if (interval === "day") {
    return `Schedule your longest session ${peakTimeOfDay(bars)}—that’s where today’s focus peaks in the data.`;
  }
  if (interval === "week") {
    return `Block a longer focus slot on ${peakDayName(bars)}; that’s when this week’s curve tops out.`;
  }
  return `Month-level data is coarse, but ${peakMonthPhase(bars)} is your strongest stretch—bias longer sessions there.`;
}

function replyImprove(input: AnalyticsInsightInput): string {
  const { headline } = deriveInsights(input);
  const { items } = deriveRecommendations(input);
  const tip = items[0] ?? "Keep one list you trust and finish one small task before adding more.";
  return `${headline} ${tip}`;
}

/**
 * Returns a reply string if the message matches a known analytics intent; otherwise `null`
 * (caller should use a generic fallback).
 */
export function tryRuleBasedAnalyticsReply(
  message: string,
  options?: RuleBasedAnalyticsOptions
): string | null {
  const trimmed = message.trim();
  if (!trimmed) return null;

  const interval: AnalyticsInterval = options?.interval ?? "week";
  const slice =
    options?.slice ?? MOCK_ANALYTICS_BY_INTERVAL[interval];
  const input = buildInsightInput(interval, slice);
  const q = trimmed.toLowerCase();

  if (matchesOverload(q)) {
    return replyOverload(interval, input);
  }
  if (matchesProductiveDays(q)) {
    return replyProductiveDays(interval, slice);
  }
  if (matchesWhenFocused(q)) {
    return replyWhenFocused(interval, slice);
  }
  if (matchesImprove(q)) {
    return replyImprove(input);
  }

  return null;
}
