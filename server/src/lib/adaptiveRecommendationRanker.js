const { MIN_EVALUATED_OUTCOMES } = require("./agentStrategyStats");

const ALL_ACTIONS = [
  "keep_plan",
  "rebalance",
  "extend_deadline",
  "reduce_scope",
  "manual_review",
  "lighten_workload",
  "focus_session",
];

const MEMORY_STRATEGY_MAP = {
  rebalance: "rebalance",
  extend_deadline: "extend_deadline",
  reduce_scope: "reduce_scope",
  keep_plan: "keep_plan",
  lighten_workload: "extend_deadline",
};

const W_BASE = 0.4;
const W_MEMORY = 0.15;
const W_BEHAVIOR = 0.15;
const W_SAFETY = 0.3;

const NEUTRAL_SCORE = 50;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function round2(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function hasSchedulingFailure(failureModes) {
  return (failureModes || []).some((m) => m && m !== "no_failure_detected");
}

function isImpossiblePlan(rebalanceRecommendation) {
  if (!rebalanceRecommendation) return false;
  if (rebalanceRecommendation.canRebalance === true) return false;
  const rec = rebalanceRecommendation.recommendedAction;
  return rec === "extend_deadline" || rec === "reduce_scope";
}

/**
 * Derive candidate actions from current goal state (pure).
 */
function deriveCandidateActions({
  failureAnalysis,
  rebalanceRecommendation,
  goalEvaluation,
} = {}) {
  const modes = failureAnalysis?.failureModes || [];
  const rec = rebalanceRecommendation?.recommendedAction;
  const canRebalance = rebalanceRecommendation?.canRebalance === true;
  const hasFailure = hasSchedulingFailure(modes);
  const behind = goalEvaluation?.behindSchedule === true;
  const impossible = isImpossiblePlan(rebalanceRecommendation);

  const set = new Set(["manual_review"]);

  if (!behind && !hasFailure) {
    set.add("keep_plan");
  } else {
    set.add("keep_plan");
  }

  if (canRebalance) {
    set.add("rebalance");
  }

  if (impossible || rec === "extend_deadline") {
    set.add("extend_deadline");
  }
  if (impossible && rec === "reduce_scope") {
    set.add("reduce_scope");
  }
  if (rec === "reduce_scope") {
    set.add("reduce_scope");
  }

  if (hasFailure || behind) {
    set.add("lighten_workload");
    set.add("focus_session");
  }

  return [...set];
}

function computeBaseScore(action, ctx) {
  const modes = ctx.failureAnalysis?.failureModes || [];
  const rec = ctx.rebalanceRecommendation?.recommendedAction;
  const canRebalance = ctx.rebalanceRecommendation?.canRebalance === true;
  const behind = ctx.goalEvaluation?.behindSchedule === true;
  const impossible = isImpossiblePlan(ctx.rebalanceRecommendation);

  switch (action) {
    case "keep_plan":
      if (!behind && !hasSchedulingFailure(modes)) return 85;
      if (!behind) return 65;
      return 20;
    case "rebalance":
      if (canRebalance && (behind || modes.includes("overloaded_day"))) return 90;
      if (canRebalance && modes.includes("task_distribution_problem")) return 82;
      if (canRebalance) return 68;
      return 5;
    case "extend_deadline":
      if (impossible && rec === "extend_deadline") return 95;
      if (modes.includes("not_enough_available_days")) return 78;
      if (!canRebalance) return 72;
      return 35;
    case "reduce_scope":
      if (impossible && rec === "reduce_scope") return 93;
      if (!canRebalance && rec === "reduce_scope") return 88;
      return 28;
    case "lighten_workload":
      if (modes.includes("overloaded_day")) return 74;
      if (behind && !canRebalance) return 68;
      if (behind) return 58;
      return 42;
    case "focus_session":
      if (behind && canRebalance) return 62;
      if (behind) return 48;
      return 52;
    case "manual_review":
      return 44;
    default:
      return 30;
  }
}

function computeMemoryScore(action, strategyStats, adaptationUsed) {
  if (!adaptationUsed) return NEUTRAL_SCORE;

  const strategyKey = MEMORY_STRATEGY_MAP[action];
  if (!strategyKey) return NEUTRAL_SCORE;

  const row = (strategyStats?.strategyStats || []).find(
    (s) => s.strategy === strategyKey
  );
  if (!row || row.evaluatedOutcomes < 1 || row.successRate == null) {
    return NEUTRAL_SCORE;
  }

  let score = NEUTRAL_SCORE + (row.successRate - 0.5) * 60;

  if (row.timesSuggested >= 2) {
    const acceptRate =
      row.timesAccepted / Math.max(row.timesSuggested, 1);
    if (acceptRate < 0.35) score -= 18;
    else if (acceptRate > 0.7) score += 8;
  }

  if (row.successRate < 0.25 && row.evaluatedOutcomes >= 2) {
    score -= 22;
  } else if (row.successRate >= 0.66 && row.evaluatedOutcomes >= 2) {
    score += 10;
  }

  return clamp(score, 0, 100);
}

function computeBehaviorScore(action, behaviorContext) {
  if (!behaviorContext?.dataQuality?.hasEnoughData) return NEUTRAL_SCORE;

  const planning = behaviorContext.planningSignals || {};
  const focus = behaviorContext.focusPatterns || {};
  const consistency = planning.consistencyScore ?? 0.5;
  const tolerance = planning.workloadTolerance || "moderate";
  const recovery = planning.recoveryScore ?? 0.5;
  const avgFocus = focus.averageFocusMinutes ?? 0;

  let score = NEUTRAL_SCORE;

  switch (action) {
    case "rebalance":
      if (consistency < 0.35) score -= 20;
      if (tolerance === "low") score -= 14;
      if (recovery < 0.4) score -= 10;
      break;
    case "lighten_workload":
      if (tolerance === "low") score += 22;
      if (consistency < 0.35) score += 14;
      if (recovery < 0.45) score += 8;
      break;
    case "focus_session":
      if (avgFocus >= 15) score += 18;
      if ((focus.bestFocusDays || []).length >= 2) score += 8;
      break;
    case "extend_deadline":
      if (tolerance === "low") score += 12;
      break;
    case "reduce_scope":
      if (tolerance === "low" && recovery < 0.4) score += 6;
      break;
    case "keep_plan":
      if (consistency >= 0.55 && recovery >= 0.55) score += 10;
      break;
    default:
      break;
  }

  return clamp(score, 0, 100);
}

function computeSafetyScore(action, ctx) {
  const canRebalance = ctx.rebalanceRecommendation?.canRebalance === true;
  const rec = ctx.rebalanceRecommendation?.recommendedAction;
  const impossible = isImpossiblePlan(ctx.rebalanceRecommendation);
  const behind = ctx.goalEvaluation?.behindSchedule === true;

  switch (action) {
    case "rebalance":
      return canRebalance ? 100 : 0;
    case "extend_deadline":
      if (impossible && rec === "extend_deadline") return 100;
      if (!canRebalance) return 92;
      return 55;
    case "reduce_scope":
      if (impossible && rec === "reduce_scope") return 100;
      if (!canRebalance && rec === "reduce_scope") return 95;
      return 48;
    case "keep_plan":
      if (impossible) return 12;
      if (behind) return 38;
      return 92;
    case "lighten_workload":
      return 88;
    case "focus_session":
      return 86;
    case "manual_review":
      return 72;
    default:
      return 50;
  }
}

function buildActionReason(action, scores, ctx, adaptationUsed) {
  const { memoryScore, behaviorScore, safetyScore } = scores;
  const rec = ctx.rebalanceRecommendation?.recommendedAction;

  if (action === "rebalance" && safetyScore === 0) {
    return "Automatic rebalance is not feasible for this goal right now.";
  }
  if (
    (action === "extend_deadline" || action === "reduce_scope") &&
    isImpossiblePlan(ctx.rebalanceRecommendation)
  ) {
    return "Remaining work does not fit before the deadline with current constraints.";
  }
  if (action === "rebalance" && adaptationUsed && memoryScore >= 62) {
    return "Past accepted rebalances have often improved completion on similar situations.";
  }
  if (action === "rebalance" && adaptationUsed && memoryScore <= 38) {
    return "Past rebalances did not reliably improve outcomes — a lighter step may be safer.";
  }
  if (action === "lighten_workload" && behaviorScore >= 62) {
    return "Your recent patterns suggest smaller workload adjustments may fit better.";
  }
  if (action === "focus_session" && behaviorScore >= 62) {
    return "Focus sessions have been a strong signal in your recent history.";
  }
  if (action === rec) {
    return "Matches the current schedule analysis recommendation.";
  }
  if (action === "keep_plan" && !ctx.goalEvaluation?.behindSchedule) {
    return "Goal progress looks acceptable without schedule changes.";
  }
  return "Ranked from current goal evaluation and available safe options.";
}

function buildExplanation(ranking, ctx, adaptationUsed, strategyStats) {
  if (!adaptationUsed) {
    return "Using current goal evaluation only; there is not enough evaluated outcome history yet to personalize from past accepted recommendations.";
  }

  const top = ranking[0];
  if (!top) {
    return "No ranked recommendation available from current goal data.";
  }

  const row = (strategyStats?.strategyStats || []).find(
    (s) => s.strategy === MEMORY_STRATEGY_MAP[top.action]
  );

  if (top.action === "rebalance" && top.memoryScore >= 62 && row) {
    const pct = Math.round((row.successRate ?? 0) * 100);
    return `Based on ${row.evaluatedOutcomes} evaluated accepted rebalances (${pct}% improved outcomes), rebalancing is favored when feasible — still requires your confirmation.`;
  }

  if (
    (top.action === "lighten_workload" || top.action === "extend_deadline") &&
    top.memoryScore <= 42
  ) {
    return "Past aggressive schedule changes did not reliably improve outcomes; a lighter adjustment or deadline review is preferred.";
  }

  if (top.action === "extend_deadline" && isImpossiblePlan(ctx.rebalanceRecommendation)) {
    return "The plan cannot fit before the deadline; extending the deadline or reducing scope is the safe recommendation.";
  }

  return top.reason;
}

/**
 * Rank candidate actions using evaluation, memory, behavior, and safety (pure).
 *
 * @param {object} input
 */
function rankAdaptiveRecommendations({
  candidateActions,
  strategyStats,
  behaviorContext,
  goalEvaluation,
  failureAnalysis,
  rebalanceRecommendation,
} = {}) {
  const actions = (
    candidateActions?.length ? candidateActions : ALL_ACTIONS
  ).filter((a) => ALL_ACTIONS.includes(a));

  const adaptationUsed =
    strategyStats?.hasEnoughData === true &&
    (strategyStats?.evaluatedAcceptedCount ?? 0) >= MIN_EVALUATED_OUTCOMES;

  const ctx = {
    goalEvaluation: goalEvaluation || {},
    failureAnalysis: failureAnalysis || {},
    rebalanceRecommendation: rebalanceRecommendation || {},
  };

  const rankedActions = actions.map((action) => {
    const baseScore = computeBaseScore(action, ctx);
    const memoryScore = computeMemoryScore(action, strategyStats, adaptationUsed);
    const behaviorScore = computeBehaviorScore(action, behaviorContext);
    const safetyScore = computeSafetyScore(action, ctx);

    const memoryWeight = adaptationUsed ? W_MEMORY : 0;
    const memoryContribution = adaptationUsed ? memoryScore * memoryWeight : 0;

    let finalScore =
      baseScore * W_BASE +
      memoryContribution +
      behaviorScore * W_BEHAVIOR +
      safetyScore * W_SAFETY;

    if (action === "rebalance" && safetyScore === 0) {
      finalScore = 0;
    }

    const reason = buildActionReason(
      action,
      { baseScore, memoryScore, behaviorScore, safetyScore },
      ctx,
      adaptationUsed
    );

    return {
      action,
      baseScore: round2(baseScore),
      memoryScore: round2(memoryScore),
      behaviorScore: round2(behaviorScore),
      safetyScore: round2(safetyScore),
      finalScore: round2(finalScore),
      reason,
    };
  });

  rankedActions.sort((a, b) => b.finalScore - a.finalScore);

  const safeTop =
    rankedActions.find((r) => r.safetyScore > 0 && r.finalScore > 0) ||
    rankedActions[0] ||
    null;

  const explanation = buildExplanation(
    rankedActions,
    ctx,
    adaptationUsed,
    strategyStats
  );

  return {
    rankedActions,
    recommendedAction: safeTop?.action ?? null,
    adaptationUsed,
    explanation,
  };
}

module.exports = {
  ALL_ACTIONS,
  deriveCandidateActions,
  rankAdaptiveRecommendations,
  isImpossiblePlan,
};
