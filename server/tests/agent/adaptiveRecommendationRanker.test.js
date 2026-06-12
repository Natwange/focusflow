const {
  rankAdaptiveRecommendations,
  deriveCandidateActions,
} = require("../../src/lib/adaptiveRecommendationRanker");

function strategyStatsFixture(overrides = {}) {
  const base = {
    hasEnoughData: true,
    evaluatedAcceptedCount: 4,
    minRequired: 3,
    strategyStats: [
      {
        strategy: "rebalance",
        timesSuggested: 4,
        timesAccepted: 3,
        averageEffectivenessScore: 0.6,
        successRate: 0.75,
        evaluatedOutcomes: 4,
      },
      {
        strategy: "extend_deadline",
        timesSuggested: 2,
        timesAccepted: 1,
        averageEffectivenessScore: 0.4,
        successRate: 0.5,
        evaluatedOutcomes: 2,
      },
      {
        strategy: "reduce_scope",
        timesSuggested: 1,
        timesAccepted: 1,
        averageEffectivenessScore: 0.3,
        successRate: 0,
        evaluatedOutcomes: 1,
      },
      {
        strategy: "keep_plan",
        timesSuggested: 2,
        timesAccepted: 2,
        averageEffectivenessScore: 0.5,
        successRate: 0.5,
        evaluatedOutcomes: 2,
      },
    ],
  };
  return { ...base, ...overrides };
}

function feasibleBehindCtx() {
  return {
    goalEvaluation: { behindSchedule: true, status: "slightly_behind" },
    failureAnalysis: {
      failureModes: ["behind_schedule", "overloaded_day"],
    },
    rebalanceRecommendation: {
      canRebalance: true,
      recommendedAction: "rebalance",
    },
  };
}

function impossibleCtx() {
  return {
    goalEvaluation: { behindSchedule: true, status: "at_risk" },
    failureAnalysis: { failureModes: ["not_enough_available_days"] },
    rebalanceRecommendation: {
      canRebalance: false,
      recommendedAction: "extend_deadline",
      reason: "not_enough_days",
    },
  };
}

describe("rankAdaptiveRecommendations", () => {
  it("prefers rebalance when historically effective and feasible", () => {
    const ctx = feasibleBehindCtx();
    const candidateActions = deriveCandidateActions(ctx);
    const result = rankAdaptiveRecommendations({
      candidateActions,
      strategyStats: strategyStatsFixture(),
      behaviorContext: { dataQuality: { hasEnoughData: false } },
      ...ctx,
    });

    expect(result.adaptationUsed).toBe(true);
    expect(result.recommendedAction).toBe("rebalance");
    const rebalance = result.rankedActions.find((r) => r.action === "rebalance");
    expect(rebalance.finalScore).toBeGreaterThan(
      result.rankedActions.find((r) => r.action === "lighten_workload").finalScore
    );
  });

  it("avoids rebalance when infeasible even if memory favors it", () => {
    const ctx = impossibleCtx();
    const result = rankAdaptiveRecommendations({
      candidateActions: [...deriveCandidateActions(ctx), "rebalance"],
      strategyStats: strategyStatsFixture(),
      behaviorContext: { dataQuality: { hasEnoughData: false } },
      ...ctx,
    });

    const rebalance = result.rankedActions.find((r) => r.action === "rebalance");
    expect(rebalance.safetyScore).toBe(0);
    expect(rebalance.finalScore).toBe(0);
    expect(result.recommendedAction).not.toBe("rebalance");
  });

  it("recommends extend_deadline for impossible goals", () => {
    const ctx = impossibleCtx();
    const result = rankAdaptiveRecommendations({
      candidateActions: deriveCandidateActions(ctx),
      strategyStats: strategyStatsFixture({
        strategyStats: strategyStatsFixture().strategyStats.map((row) =>
          row.strategy === "rebalance"
            ? { ...row, successRate: 0.9, evaluatedOutcomes: 5 }
            : row
        ),
      }),
      behaviorContext: { dataQuality: { hasEnoughData: false } },
      ...ctx,
    });

    expect(result.recommendedAction).toBe("extend_deadline");
  });

  it("sets adaptationUsed false when insufficient history", () => {
    const ctx = feasibleBehindCtx();
    const result = rankAdaptiveRecommendations({
      candidateActions: deriveCandidateActions(ctx),
      strategyStats: {
        hasEnoughData: false,
        evaluatedAcceptedCount: 1,
        strategyStats: strategyStatsFixture().strategyStats,
      },
      behaviorContext: { dataQuality: { hasEnoughData: false } },
      ...ctx,
    });

    expect(result.adaptationUsed).toBe(false);
    expect(result.explanation).toMatch(/not enough evaluated outcome history/i);
    const rebalance = result.rankedActions.find((r) => r.action === "rebalance");
    expect(rebalance.memoryScore).toBe(50);
  });

  it("lowers score for historically worsened strategy", () => {
    const ctx = feasibleBehindCtx();
    const worsened = strategyStatsFixture({
      strategyStats: strategyStatsFixture().strategyStats.map((row) =>
        row.strategy === "rebalance"
          ? {
              ...row,
              successRate: 0.15,
              evaluatedOutcomes: 4,
              timesSuggested: 6,
              timesAccepted: 2,
            }
          : row
      ),
    });

    const withGood = rankAdaptiveRecommendations({
      candidateActions: deriveCandidateActions(ctx),
      strategyStats: strategyStatsFixture(),
      behaviorContext: { dataQuality: { hasEnoughData: false } },
      ...ctx,
    });
    const withBad = rankAdaptiveRecommendations({
      candidateActions: deriveCandidateActions(ctx),
      strategyStats: worsened,
      behaviorContext: { dataQuality: { hasEnoughData: false } },
      ...ctx,
    });

    const goodReb = withGood.rankedActions.find((r) => r.action === "rebalance");
    const badReb = withBad.rankedActions.find((r) => r.action === "rebalance");
    expect(badReb.memoryScore).toBeLessThan(goodReb.memoryScore);
    expect(badReb.finalScore).toBeLessThan(goodReb.finalScore);
  });

  it("behavior signals influence ranking but do not override constraints", () => {
    const ctx = impossibleCtx();
    const lowConsistencyBehavior = {
      dataQuality: { hasEnoughData: true },
      planningSignals: {
        consistencyScore: 0.2,
        workloadTolerance: "low",
        recoveryScore: 0.3,
      },
      focusPatterns: { averageFocusMinutes: 25, bestFocusDays: ["TUE"] },
    };

    const result = rankAdaptiveRecommendations({
      candidateActions: [...deriveCandidateActions(ctx), "rebalance"],
      strategyStats: strategyStatsFixture(),
      behaviorContext: lowConsistencyBehavior,
      ...ctx,
    });

    expect(result.recommendedAction).toBe("extend_deadline");
    const lighten = result.rankedActions.find((r) => r.action === "lighten_workload");
    const rebalance = result.rankedActions.find((r) => r.action === "rebalance");
    expect(lighten.behaviorScore).toBeGreaterThan(rebalance.behaviorScore);
    expect(rebalance.safetyScore).toBe(0);
  });

  it("uses evidence-based explanation when adaptation is active", () => {
    const ctx = feasibleBehindCtx();
    const result = rankAdaptiveRecommendations({
      candidateActions: deriveCandidateActions(ctx),
      strategyStats: strategyStatsFixture(),
      behaviorContext: { dataQuality: { hasEnoughData: false } },
      ...ctx,
    });

    expect(result.explanation).toMatch(/evaluated accepted rebalances/i);
    expect(result.explanation).not.toMatch(/always|perfectly learned/i);
  });

  it("does not hallucinate adaptation claims when low data", () => {
    const ctx = feasibleBehindCtx();
    const result = rankAdaptiveRecommendations({
      candidateActions: deriveCandidateActions(ctx),
      strategyStats: { hasEnoughData: false, evaluatedAcceptedCount: 0, strategyStats: [] },
      behaviorContext: { dataQuality: { hasEnoughData: false } },
      ...ctx,
    });

    expect(result.adaptationUsed).toBe(false);
    expect(result.explanation).toMatch(/not enough evaluated outcome history/i);
    expect(result.explanation).not.toMatch(/%\s*improved|evaluated accepted rebalances/i);
  });
});
