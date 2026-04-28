/**
 * Rule-based “AI” copy from analytics shapes — swap for real LLM output later.
 * Keep logic here; UI only renders strings.
 */

import type { AnalyticsInterval, ProductivityPeriodMetrics } from "./productivityScore";
import { tasksCompletionRate } from "./productivityScore";

export type AnalyticsInsightInput = {
  interval: AnalyticsInterval;
  current: ProductivityPeriodMetrics;
  previous: ProductivityPeriodMetrics;
  trendBars: number[];
  loadBars: number[];
  completeBars: number[];
  currentScore: number;
  scoreDelta: number;
};

function indexOfMax(values: number[]): number {
  if (values.length === 0) return 0;
  let best = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i]! > values[best]!) best = i;
  }
  return best;
}

/** Share of steps where planned load noticeably exceeds completion (mock series). */
function overloadStepRatio(load: number[], complete: number[]): number {
  const n = Math.min(load.length, complete.length);
  if (n === 0) return 0;
  let heavy = 0;
  for (let i = 0; i < n; i++) {
    const l = load[i] ?? 0;
    const c = complete[i] ?? 0;
    if (l <= 0) continue;
    if ((l - c) / l > 0.2) heavy++;
  }
  return heavy / n;
}

function mostProductiveDayLabel(trendBars: number[]): string {
  const i = indexOfMax(trendBars);
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  return days[Math.min(i, days.length - 1)] ?? "one day";
}

function mostProductiveTimeLabel(trendBars: number[]): string {
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

function mostProductiveMonthPhase(trendBars: number[]): string {
  const i = indexOfMax(trendBars);
  const n = trendBars.length;
  const t = n <= 1 ? 0.5 : i / (n - 1);
  if (t < 0.34) return "earlier in the month";
  if (t < 0.67) return "mid-month";
  return "toward the end of the month";
}

function productivityTrendPhrase(scoreDelta: number, compareSnippet: string): string {
  if (scoreDelta >= 4) {
    return `Your productivity score is up a few points ${compareSnippet}—nice momentum.`;
  }
  if (scoreDelta <= -4) {
    return `Your score dipped a bit ${compareSnippet}; that happens when the list gets heavier or focus slips.`;
  }
  if (scoreDelta > 0) {
    return `You’re slightly ahead ${compareSnippet} on the score—steady progress.`;
  }
  if (scoreDelta < 0) {
    return `You’re a touch under ${compareSnippet} on the score—nothing drastic.`;
  }
  return `Your score is about level ${compareSnippet}.`;
}

function compareSnippet(interval: AnalyticsInterval): string {
  if (interval === "day") return "from yesterday";
  if (interval === "week") return "from last week";
  return "from last month";
}

export function detectOverloadPattern(input: AnalyticsInsightInput): boolean {
  const rate = tasksCompletionRate(input.current);
  const ratio = overloadStepRatio(input.loadBars, input.completeBars);
  const plannedHeavy = input.current.tasksPlanned >= 8;
  if (rate < 0.68 && plannedHeavy) return true;
  if (ratio >= 0.45 && input.current.tasksPlanned >= 6) return true;
  return false;
}

export type DerivedInsights = {
  headline: string;
  bullets: string[];
};

export type DerivedRecommendations = {
  items: string[];
};

/**
 * Short, human bullets — what an assistant might say after “reading” the charts.
 */
export function deriveInsights(input: AnalyticsInsightInput): DerivedInsights {
  const { interval, current, previous, trendBars, currentScore, scoreDelta } =
    input;
  const cmp = compareSnippet(interval);
  const bullets: string[] = [];

  if (trendBars.length > 0) {
    if (interval === "week") {
      bullets.push(
        `Your strongest stretch looks like ${mostProductiveDayLabel(trendBars)}—that’s when focus peaks in this view.`
      );
    } else if (interval === "day") {
      bullets.push(
        `You tend to shine ${mostProductiveTimeLabel(trendBars)}; that’s your steadiest window here.`
      );
    } else {
      bullets.push(
        `Energy clusters ${mostProductiveMonthPhase(trendBars)} in this snapshot.`
      );
    }
  }

  bullets.push(productivityTrendPhrase(scoreDelta, cmp));

  const overload = detectOverloadPattern(input);
  if (overload) {
    bullets.push(
      `Planned work is running ahead of what’s getting closed—easy to feel overloaded even when you’re trying.`
    );
  } else if (tasksCompletionRate(current) >= 0.78) {
    bullets.push(
      `You’re finishing a solid share of what you plan—that usually means the list and reality are in sync.`
    );
  }

  if (current.streakDays >= 5 && !overload) {
    bullets.push(
      `Your ${current.streakDays}-day streak adds quiet consistency; small daily wins compound.`
    );
  }

  const focusDelta = current.focusMinutes - previous.focusMinutes;
  if (!overload && Math.abs(focusDelta) >= 45 && interval !== "day") {
    if (focusDelta > 0) {
      bullets.push(
        `You logged more focus time than the prior period—protect whatever made that possible.`
      );
    } else {
      bullets.push(
        `Focus time is a bit lighter than before; even one longer block can shift how the week feels.`
      );
    }
  }

  // Cap length; keep calm reading pace
  const trimmed = bullets.slice(0, 4);

  let headline: string;
  if (overload) {
    headline = "Your list might be asking for a little breathing room.";
  } else if (scoreDelta >= 4) {
    headline = "You’re in a stronger groove than last time.";
  } else if (scoreDelta <= -4) {
    headline = "A softer week—worth a gentle reset, not a guilt trip.";
  } else if (currentScore >= 72) {
    headline = "Overall, things look balanced and workable.";
  } else {
    headline = "Here’s what stands out in your rhythm right now.";
  }

  return { headline, bullets: trimmed };
}

/**
 * Actionable nudges derived from the same signals (no extra magic).
 */
export function deriveRecommendations(input: AnalyticsInsightInput): DerivedRecommendations {
  const { interval, current, trendBars, scoreDelta } = input;
  const items: string[] = [];
  const overload = detectOverloadPattern(input);

  if (overload) {
    items.push(
      "Trim or postpone two tasks that aren’t truly due this period—completion will feel kinder."
    );
    items.push(
      "Block one uninterrupted focus slot before new work lands; it protects what’s already on the list."
    );
  }

  if (interval === "week" && trendBars.length > 0) {
    const day = mostProductiveDayLabel(trendBars);
    items.push(
      `Put your hardest task on ${day} if you can—that’s where your curve peaks.`
    );
  } else if (interval === "day" && trendBars.length > 0) {
    const slot = mostProductiveTimeLabel(trendBars);
    items.push(
      `Guard ${slot} for one meaningful block; you’ll get more done with less friction.`
    );
  } else if (interval === "month" && trendBars.length > 0) {
    items.push(
      `Repeat what worked ${mostProductiveMonthPhase(trendBars)} next month—same shape, less guesswork.`
    );
  }

  if (scoreDelta <= -3 && !overload) {
    items.push(
      "Pick one small win to close today; it lifts the score and your sense of control."
    );
  }

  if (scoreDelta >= 3 && !overload) {
    items.push(
      "Keep this week’s recipe: don’t add scope until something equal comes off the list."
    );
  }

  if (current.avgSessionMinutes < 22 && items.length < 3) {
    items.push(
      "Try stretching one session by ~10 minutes when you’re in flow—depth beats more starts."
    );
  }

  // Dedupe while preserving order
  const seen = new Set<string>();
  const unique = items.filter((s) => {
    const k = s.slice(0, 48);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  if (unique.length === 0) {
    unique.push(
      "You’re already reflecting on the data—that’s the habit that moves the needle."
    );
  }

  return { items: unique.slice(0, 3) };
}
