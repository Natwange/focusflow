/**
 * Insights and recommendations derived only from GET /analytics/activity-patterns
 * (userActivityPatternAnalyzer). Copy is factual: numbers and labels come from the payload.
 */

import type { ActivityPatternsDto } from "./analyticsApi";
import type { DerivedInsights, DerivedRecommendations } from "./analyticsInsights";

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export function deriveInsightsFromActivityPatterns(
  p: ActivityPatternsDto
): DerivedInsights {
  const w = p.windowDays;
  const headline = p.lowData
    ? `Limited dated activity in the last ${w} days — weekday highs/lows are preliminary.`
    : `Patterns from your last ${w} days (weekdays are UTC — charts above use your local time).`;

  const bullets: string[] = [p.summary];

  const {
    taskSignals,
    focusSignals,
    consistencySignals,
    agentSignals,
    bestDays,
    weakDays,
  } = p;

  if (!p.lowData && taskSignals.totalTasks > 0) {
    bullets.push(
      `Tasks in this sample: ${taskSignals.completedTasks} completed, ${taskSignals.missedTasks} missed (overdue and not done), ${taskSignals.totalTasks} with dates in scope — ${pct(taskSignals.completionRate)} completed.`
    );
  }

  if (!p.lowData && focusSignals.totalFocusMinutes > 0) {
    const tail = focusSignals.bestFocusDay
      ? ` Peak focus minutes on ${focusSignals.bestFocusDay} (UTC).`
      : "";
    bullets.push(
      `Focus time logged: ${focusSignals.totalFocusMinutes} minutes total; about ${focusSignals.averageFocusMinutesPerActiveDay} min per day that had any focus.${tail}`
    );
  } else if (!p.lowData && taskSignals.totalTasks > 0 && focusSignals.totalFocusMinutes === 0) {
    bullets.push("No focus minutes in this window — only task dates drove the pattern.");
  }

  if (!p.lowData && (bestDays.length > 0 || weakDays.length > 0)) {
    if (bestDays.length > 0) {
      bullets.push(`Stronger UTC weekdays in this sample: ${bestDays.join(", ")}.`);
    }
    if (weakDays.length > 0) {
      bullets.push(`Weaker UTC weekdays in this sample: ${weakDays.join(", ")}.`);
    }
  }

  if (!p.lowData && consistencySignals.activeDays > 0) {
    bullets.push(
      `You had activity (tasks, focus, or agent runs) on ${consistencySignals.activeDays} distinct days; visit streak from profile: ${consistencySignals.currentStreak} day(s), longest run of consecutive active days in this sample up to ${consistencySignals.longestStreak}.`
    );
  }

  if (!p.lowData && agentSignals.totalRecommendations > 0) {
    bullets.push(
      `Goal agent: ${agentSignals.acceptedRecommendations} of ${agentSignals.totalRecommendations} runs accepted (${pct(agentSignals.acceptanceRate)}).`
    );
  }

  return { headline, bullets: bullets.slice(0, 5) };
}

export function deriveRecommendationsFromActivityPatterns(
  p: ActivityPatternsDto
): DerivedRecommendations {
  const items: string[] = [];

  if (p.lowData) {
    items.push(
      `Keep adding due dates, completing tasks, and logging focus sessions — the analyzer marked this sample as low-data (not enough dated events or agent runs in the last ${p.windowDays} days).`
    );
    return { items: items.slice(0, 3) };
  }

  if (p.taskSignals.missedTasks > 0) {
    items.push(
      `Address ${p.taskSignals.missedTasks} overdue incomplete task(s) in this ${p.windowDays}-day sample — finish, drop, or move the due date so the plan matches reality.`
    );
  }

  if (p.focusSignals.totalFocusMinutes === 0 && p.taskSignals.totalTasks > 0) {
    items.push(
      "Log focus sessions when you work — that adds real time-on-task next to your task stats for future snapshots."
    );
  }

  if (p.weakDays.length > 0 && p.bestDays.length > 0) {
    items.push(
      `Data shows more completion/focus on ${p.bestDays.join(", ")} than on ${p.weakDays.join(", ")} (UTC) — if that matches how you feel, protect strong days for hard work and lighten weak days when you can.`
    );
  } else if (p.weakDays.length > 0) {
    items.push(
      `Completion or focus dipped on ${p.weakDays.join(", ")} (UTC) — check what was scheduled those days before changing habits.`
    );
  }

  if (
    p.agentSignals.totalRecommendations >= 3 &&
    p.agentSignals.acceptanceRate < 0.34
  ) {
    items.push(
      `Only ${pct(p.agentSignals.acceptanceRate)} of goal agent suggestions were accepted — worth checking if proposals match your deadlines and capacity.`
    );
  }

  if (items.length === 0) {
    items.push(
      "No extra actions from pattern thresholds; keep logging activity and revisit after more weeks of data."
    );
  }

  return { items: items.slice(0, 3) };
}
