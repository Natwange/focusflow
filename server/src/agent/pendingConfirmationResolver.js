/**
 * @param {string} message
 * @returns {boolean}
 */
function isAffirmativeConfirmation(message) {
  const text = String(message ?? "").trim().toLowerCase();
  if (!text) return false;

  const patterns = [
    /^yes(?:[,.!?\s]|$)/,
    /^yeah\b/,
    /^yep\b/,
    /^yup\b/,
    /^sure\b/,
    /^ok(?:ay)?\b/,
    /^confirm\b/,
    /^go ahead\b/,
    /^do it\b/,
    /^create it\b/,
    /^yes,?\s*create\s+it/,
    /^schedule\s+it\b/,
    /^yes,?\s*delete\s+it/,
    /^delete\s+it\b/,
    /^yes,?\s*apply\s+it/,
    /^apply\s+it\b/,
    /^please\s+(?:create|schedule|confirm|delete|apply)\b/,
  ];

  return patterns.some((pattern) => pattern.test(text));
}

/**
 * Map client-held pending confirmation to a validated tool call (server-owned ids).
 *
 * @param {object | null | undefined} pendingConfirmation
 * @returns {{ toolName: string, toolArgs: object } | null}
 */
function pendingConfirmationToToolCall(pendingConfirmation) {
  if (!pendingConfirmation || typeof pendingConfirmation !== "object") {
    return null;
  }

  if (
    pendingConfirmation.type === "confirm_goal_plan" &&
    pendingConfirmation.goalId
  ) {
    return {
      toolName: "confirm_goal_plan",
      toolArgs: {
        goalId: String(pendingConfirmation.goalId),
        confirmed: true,
      },
    };
  }

  if (
    pendingConfirmation.type === "delete_task" &&
    pendingConfirmation.taskId
  ) {
    return {
      toolName: "delete_task",
      toolArgs: {
        taskId: String(pendingConfirmation.taskId),
        confirmed: true,
      },
    };
  }

  if (
    pendingConfirmation.type === "apply_goal_rebalance" &&
    pendingConfirmation.goalId
  ) {
    return {
      toolName: "apply_goal_rebalance",
      toolArgs: {
        goalId: String(pendingConfirmation.goalId),
        confirmed: true,
      },
    };
  }

  return null;
}

module.exports = {
  isAffirmativeConfirmation,
  pendingConfirmationToToolCall,
};
