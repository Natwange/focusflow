const crypto = require("crypto");
const { evaluateGoalProgress } = require("./evaluationEngine");
const { detectFailureModes } = require("./failureModeDetector");
const { recommendRebalance } = require("./rebalanceRecommendationEngine");

const STATUS_LABELS = {
  on_track: "on track",
  slightly_behind: "slightly behind",
  at_risk: "at risk",
};

const FAILURE_LABELS = {
  no_failure_detected: null,
  overloaded_day: "some days are overloaded with more tasks than your daily limit allows",
  too_many_missed_tasks: "a large share of tasks are overdue",
  behind_schedule: "overall progress is behind where it should be today",
  not_enough_available_days: "there are not enough open days left before the deadline for the remaining work",
  task_distribution_problem: "work is unevenly stacked on a few days instead of spread across your available days",
};

const ACTION_SUMMARY = {
  keep_plan: "keep your current plan",
  rebalance: "rebalance by moving incomplete tasks to better dates",
  extend_deadline: "extend the deadline so the remaining work can fit",
  reduce_scope: "reduce scope or split the goal so it fits the time you have",
  manual_review: "review and adjust the schedule yourself",
};

function humanizeStatus(status) {
  if (!status || typeof status !== "string") return "unknown";
  if (STATUS_LABELS[status]) return STATUS_LABELS[status];
  return status.replace(/_/g, " ");
}

function humanizeFailureModes(modes) {
  if (!Array.isArray(modes)) return [];
  return modes
    .filter((m) => m && m !== "no_failure_detected")
    .map((m) => FAILURE_LABELS[m] || String(m).replace(/_/g, " "));
}

function joinIssues(phrases) {
  if (phrases.length === 0) return "";
  if (phrases.length === 1) return phrases[0];
  if (phrases.length === 2) return `${phrases[0]} and ${phrases[1]}`;
  return `${phrases.slice(0, -1).join("; ")}, and ${phrases[phrases.length - 1]}`;
}

function resolveActionKey(rebalanceRecommendation) {
  const key = rebalanceRecommendation?.recommendedAction;
  if (key && ACTION_SUMMARY[key]) return key;
  return "manual_review";
}

/**
 * @returns {{ recommendation: string, recommendationSegments: Array<{ text: string, emphasis?: boolean }> }}
 */
function buildRecommendation({
  evaluation,
  failureAnalysis,
  rebalanceRecommendation,
}) {
  const segments = [];
  const statusHuman = humanizeStatus(evaluation?.status);

  segments.push({ text: "Overall, you are " });
  segments.push({ text: statusHuman, emphasis: true });
  segments.push({ text: " relative to this goal’s timeline. " });

  const issues = humanizeFailureModes(failureAnalysis?.failureModes);
  if (issues.length > 0) {
    segments.push({ text: "What stands out: " });
    segments.push({ text: joinIssues(issues), emphasis: true });
    segments.push({ text: ". " });
  } else {
    segments.push({
      text: "No separate scheduling issue was flagged beyond that headline. ",
    });
  }

  const actionKey = resolveActionKey(rebalanceRecommendation);
  const actionPhrase = ACTION_SUMMARY[actionKey];

  segments.push({ text: "Suggested next step: " });
  segments.push({ text: actionPhrase, emphasis: true });
  segments.push({ text: "." });

  const recommendation = segments.map((s) => s.text).join("");
  return { recommendation, recommendationSegments: segments };
}

function runGoalAgent({ goal, tasks, now = new Date() }) {
  const evaluation = evaluateGoalProgress({ goal, tasks, now });
  const failureAnalysis = detectFailureModes({ goal, tasks, evaluation, now });
  const rebalanceRecommendation = recommendRebalance({
    goal,
    tasks,
    evaluation,
    failureAnalysis,
    now,
  });

  const { recommendation, recommendationSegments } = buildRecommendation({
    evaluation,
    failureAnalysis,
    rebalanceRecommendation,
  });
  const nextAction = rebalanceRecommendation.recommendedAction;

  return {
    goalId: goal?.id || null,
    agentRunId: crypto.randomUUID(),
    evaluation,
    failureAnalysis,
    rebalanceRecommendation,
    recommendation,
    recommendationSegments,
    nextAction,
  };
}

module.exports = {
  runGoalAgent,
};
