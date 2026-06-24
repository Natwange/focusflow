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
    /^yes,?\s*send\s+it/,
    /^send\s+it\b/,
    /^yes,?\s*schedule\s+it/,
    /^schedule\s+it\b/,
    /^yes,?\s*export\s+it/,
    /^export\s+it\b/,
    /^yes,?\s*create\s+it/,
    /^please\s+(?:create|schedule|confirm|delete|apply|send|export)\b/,
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

  if (
    pendingConfirmation.type === "apply_goal_adjustment" &&
    pendingConfirmation.goalId
  ) {
    const toolArgs = {
      goalId: String(pendingConfirmation.goalId),
      confirmed: true,
    };
    if (pendingConfirmation.deadline) {
      toolArgs.deadline = String(pendingConfirmation.deadline);
    }
    if (pendingConfirmation.maxUnitsPerDay !== undefined) {
      toolArgs.maxUnitsPerDay = pendingConfirmation.maxUnitsPerDay;
    }
    if (pendingConfirmation.spreadEvenly !== undefined) {
      toolArgs.spreadEvenly = Boolean(pendingConfirmation.spreadEvenly);
    }
    return { toolName: "apply_goal_adjustment", toolArgs };
  }

  if (
    pendingConfirmation.type === "gmail_send_email" &&
    pendingConfirmation.to &&
    pendingConfirmation.subject &&
    pendingConfirmation.body
  ) {
    return {
      toolName: "gmail_send_email",
      toolArgs: {
        to: String(pendingConfirmation.to),
        subject: String(pendingConfirmation.subject),
        body: String(pendingConfirmation.body),
        cc: pendingConfirmation.cc,
        bcc: pendingConfirmation.bcc,
        confirmed: true,
      },
    };
  }

  if (
    (pendingConfirmation.type === "calendar_create_event" ||
      pendingConfirmation.type === "calendar_bulk_create") &&
    Array.isArray(pendingConfirmation.events) &&
    pendingConfirmation.events.length > 0
  ) {
    return {
      toolName: "calendar_create_event",
      toolArgs: {
        events: pendingConfirmation.events,
        confirmed: true,
      },
    };
  }

  if (
    pendingConfirmation.type === "notion_export_goal" &&
    pendingConfirmation.goalId
  ) {
    return {
      toolName: "notion_export_goal",
      toolArgs: {
        goalId: String(pendingConfirmation.goalId),
        goalTitle: pendingConfirmation.goalTitle,
        pageTitle: pendingConfirmation.pageTitle,
        parentPageId: pendingConfirmation.parentPageId,
        confirmed: true,
      },
    };
  }

  if (
    pendingConfirmation.type === "notion_create_page" &&
    pendingConfirmation.title &&
    pendingConfirmation.content
  ) {
    return {
      toolName: "notion_create_page",
      toolArgs: {
        title: String(pendingConfirmation.title),
        content: String(pendingConfirmation.content),
        parentPageId: pendingConfirmation.parentPageId,
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
