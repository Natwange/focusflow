const prisma = require("../../lib/prisma");
const { executeComposioAction } = require("./composioClient");
const { getActiveConnectedAccountId } = require("./connectionService");
const { TOOL_SLUGS } = require("./composioToolSlugs");
const { logComposioApprovalEvent } = require("./composioTracing");
const { resolveGoal } = require("../../lib/goalResolver");

const TOOLKIT = "notion";

function formatGoalPlanMarkdown(goal, tasks) {
  const lines = [
    `# ${goal.title}`,
    "",
    `**Deadline:** ${goal.deadline ? new Date(goal.deadline).toISOString().slice(0, 10) : "—"}`,
    `**Total units:** ${goal.totalUnits}`,
    "",
    "## Plan",
  ];

  for (const task of tasks) {
    const due = task.dueDate
      ? new Date(task.dueDate).toISOString().slice(0, 10)
      : "unscheduled";
    lines.push(`- ${task.title} (due ${due})`);
  }

  return lines.join("\n");
}

async function runNotionCreatePage(userId, args) {
  const accountId = await getActiveConnectedAccountId(userId, TOOLKIT);
  if (!accountId) {
    return {
      ok: false,
      summary: "Notion is not connected. Connect it in Settings first.",
      error: "not_connected",
    };
  }

  const preview = {
    title: args.title,
    content: args.content,
    parentPageId: args.parentPageId ?? null,
  };

  if (!args.confirmed) {
    return {
      ok: true,
      data: {
        preview,
        pendingConfirmation: {
          type: "notion_create_page",
          ...preview,
        },
      },
      summary: `Notion page preview: "${args.title}". Say "yes, create it" to confirm.`,
    };
  }

  logComposioApprovalEvent({ type: "notion_create_page", userId, approved: true });

  const result = await executeComposioAction(
    userId,
    TOOLKIT,
    TOOL_SLUGS.notion.createPage,
    {
      title: args.title,
      content: args.content,
      parent_id: args.parentPageId,
    },
    { connectedAccountId: accountId }
  );

  if (!result.ok) {
    return { ok: false, summary: result.summary, error: result.error };
  }

  return {
    ok: true,
    data: { page: result.data, preview },
    summary: `Created Notion page "${args.title}".`,
  };
}

async function runNotionExportGoal(userId, args) {
  const accountId = await getActiveConnectedAccountId(userId, TOOLKIT);
  if (!accountId) {
    return {
      ok: false,
      summary: "Notion is not connected. Connect it in Settings first.",
      error: "not_connected",
    };
  }

  const goal = await resolveGoal(userId, {
    goalId: args.goalId,
    goalTitle: args.goalTitle,
  });
  if (!goal) {
    return {
      ok: false,
      summary: "Goal not found.",
      error: "goal_not_found",
    };
  }

  const tasks = await prisma.task.findMany({
    where: { userId, goalId: goal.id },
    orderBy: { dueDate: "asc" },
    select: { title: true, dueDate: true, status: true },
  });

  const title = args.pageTitle || `${goal.title} — FocusFlow Plan`;
  const content = formatGoalPlanMarkdown(goal, tasks);
  const preview = { title, content, goalId: goal.id, goalTitle: goal.title };

  if (!args.confirmed) {
    return {
      ok: true,
      data: {
        preview,
        pendingConfirmation: {
          type: "notion_export_goal",
          goalId: goal.id,
          goalTitle: goal.title,
          pageTitle: title,
          content,
        },
      },
      summary: `Notion export preview for "${goal.title}". Say "yes, export it" to create the page.`,
    };
  }

  logComposioApprovalEvent({ type: "notion_export_goal", userId, approved: true });

  const result = await executeComposioAction(
    userId,
    TOOLKIT,
    TOOL_SLUGS.notion.createPage,
    {
      title,
      content,
      parent_id: args.parentPageId,
    },
    { connectedAccountId: accountId }
  );

  if (!result.ok) {
    return { ok: false, summary: result.summary, error: result.error };
  }

  return {
    ok: true,
    data: { page: result.data, goalId: goal.id, goalTitle: goal.title },
    summary: `Exported "${goal.title}" to Notion as "${title}".`,
  };
}

module.exports = {
  runNotionCreatePage,
  runNotionExportGoal,
};
