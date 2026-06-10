const prisma = require("./prisma");
const { startOfDay } = require("./buildPlan");
const { evaluateGoalProgress } = require("./evaluationEngine");
const { runGoalAgent } = require("./goalAgentOrchestrator");

const GOAL_AGENT_SELECT = {
  id: true,
  userId: true,
  title: true,
  totalUnits: true,
  unitName: true,
  createdAt: true,
  deadline: true,
  availableDays: true,
  maxUnitsPerDay: true,
};

const TASK_AGENT_SELECT = {
  id: true,
  title: true,
  status: true,
  dueDate: true,
  unitStart: true,
  unitEnd: true,
};

/**
 * @param {string} userId
 * @param {string} goalId
 */
async function requireOwnedGoal(userId, goalId) {
  const goal = await prisma.goal.findUnique({
    where: { id: goalId },
    select: GOAL_AGENT_SELECT,
  });
  if (!goal) {
    const err = new Error("Goal not found.");
    err.code = "NOT_FOUND";
    throw err;
  }
  if (String(goal.userId) !== String(userId)) {
    const err = new Error("Goal does not belong to you.");
    err.code = "FORBIDDEN";
    throw err;
  }
  return goal;
}

/**
 * @param {string} userId
 * @param {string} goalId
 */
async function loadGoalTasks(userId, goalId) {
  return prisma.task.findMany({
    where: { userId, goalId },
    select: TASK_AGENT_SELECT,
  });
}

/**
 * @param {Array<{ status: string }>} tasks
 */
function isGoalCompleted(tasks) {
  if (!tasks || tasks.length === 0) return false;
  return tasks.every((t) => t.status === "done");
}

/**
 * @param {string} userId
 * @param {{ status?: "active" | "completed" | "all" }} [opts]
 */
async function listGoalsForUser(userId, { status = "active" } = {}) {
  const goals = await prisma.goal.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      deadline: true,
      totalUnits: true,
      unitName: true,
      createdAt: true,
      availableDays: true,
      maxUnitsPerDay: true,
    },
  });

  if (goals.length === 0) return [];

  const goalIds = goals.map((g) => g.id);
  const allTasks = await prisma.task.findMany({
    where: { userId, goalId: { in: goalIds } },
    select: {
      goalId: true,
      status: true,
      dueDate: true,
      unitStart: true,
      unitEnd: true,
    },
  });

  const tasksByGoal = new Map();
  for (const task of allTasks) {
    if (!tasksByGoal.has(task.goalId)) tasksByGoal.set(task.goalId, []);
    tasksByGoal.get(task.goalId).push(task);
  }

  const now = new Date();
  const nowDay = startOfDay(now);

  const summaries = goals.map((goal) => {
    const tasks = tasksByGoal.get(goal.id) || [];
    const completed = isGoalCompleted(tasks);
    const taskCounts = {
      total: tasks.length,
      completed: tasks.filter((t) => t.status === "done").length,
      incomplete: tasks.filter((t) => t.status !== "done").length,
      missed: tasks.filter((t) => {
        if (t.status === "done" || !t.dueDate) return false;
        const due = new Date(t.dueDate);
        return startOfDay(due).getTime() < nowDay.getTime();
      }).length,
    };

    let progress = null;
    if (tasks.length > 0) {
      const evaluation = evaluateGoalProgress({ goal, tasks, now });
      progress = {
        status: evaluation.status,
        completionRate: evaluation.completionRate,
        behindSchedule: evaluation.behindSchedule,
        completedUnits: evaluation.completedUnits,
        totalUnits: evaluation.totalUnits,
      };
    }

    return {
      goalId: goal.id,
      title: goal.title,
      deadline: goal.deadline,
      totalUnits: goal.totalUnits,
      unitName: goal.unitName,
      taskCounts,
      progress,
      completed,
    };
  });

  if (status === "all") return summaries;
  if (status === "completed") return summaries.filter((g) => g.completed);
  return summaries.filter((g) => !g.completed);
}

/**
 * @param {string} userId
 * @param {string} goalId
 * @param {{ logRun?: boolean, source?: string | null }} [opts]
 */
async function getGoalAgentPreviewForUser(
  userId,
  goalId,
  { logRun = true, source = "chat" } = {}
) {
  const goal = await requireOwnedGoal(userId, goalId);
  const tasks = await loadGoalTasks(userId, goalId);

  const result = runGoalAgent({
    goal,
    tasks,
    now: new Date(),
  });

  if (logRun) {
    const rebalancePreview = {
      ...result.rebalanceRecommendation,
      ...(source ? { _source: source } : {}),
    };
    await prisma.agentRun.create({
      data: {
        goalId: goal.id,
        userId,
        evaluation: result.evaluation,
        failureAnalysis: result.failureAnalysis,
        recommendation: result.recommendation,
        nextAction: result.nextAction,
        rebalancePreview,
      },
    });
  }

  return {
    ...result,
    goalTitle: goal.title,
  };
}

/**
 * @param {string} userId
 * @param {string} goalId
 */
async function applyGoalRebalanceForUser(userId, goalId) {
  const goal = await requireOwnedGoal(userId, goalId);
  const tasks = await loadGoalTasks(userId, goalId);

  const agentResult = runGoalAgent({
    goal,
    tasks,
    now: new Date(),
  });

  const rec = agentResult.rebalanceRecommendation;
  if (!rec?.canRebalance) {
    const err = new Error(rec?.reason || "Rebalance cannot be applied.");
    err.code = "CANNOT_REBALANCE";
    err.nextAction = agentResult.nextAction || "manual_review";
    err.agentResult = agentResult;
    throw err;
  }

  const taskById = new Map(tasks.map((t) => [String(t.id), t]));
  const plannedChanges = Array.isArray(rec.changes) ? rec.changes : [];
  const updateChanges = [];

  for (const change of plannedChanges) {
    const taskId = String(change?.taskId || "");
    const targetTask = taskById.get(taskId);
    if (!targetTask) {
      const err = new Error(`Invalid rebalance change target: ${taskId}`);
      err.code = "INVALID_CHANGE";
      err.nextAction = "manual_review";
      throw err;
    }
    if (targetTask.status === "done") {
      continue;
    }
    const toDate = new Date(change.to);
    if (Number.isNaN(toDate.getTime())) {
      const err = new Error(`Invalid rebalance target date for task: ${taskId}`);
      err.code = "INVALID_CHANGE";
      err.nextAction = "manual_review";
      throw err;
    }
    updateChanges.push({ taskId, toDate });
  }

  const updatedTasks =
    updateChanges.length > 0
      ? await prisma.$transaction(
          updateChanges.map((c) =>
            prisma.task.update({
              where: { id: c.taskId },
              data: { dueDate: c.toDate },
              select: {
                id: true,
                title: true,
                status: true,
                dueDate: true,
                goalId: true,
              },
            })
          )
        )
      : [];

  const latestRun = await prisma.agentRun.findFirst({
    where: { goalId: goal.id, userId },
    orderBy: { createdAt: "desc" },
  });
  if (latestRun) {
    await prisma.agentRun.update({
      where: { id: latestRun.id },
      data: { acceptedByUser: true },
    });
  }

  return {
    goalId: goal.id,
    goalTitle: goal.title,
    applied: true,
    changeCount: updateChanges.length,
    updatedTasks,
    agentResult: {
      evaluation: agentResult.evaluation,
      failureAnalysis: agentResult.failureAnalysis,
      rebalanceRecommendation: agentResult.rebalanceRecommendation,
      recommendation: agentResult.recommendation,
      nextAction: agentResult.nextAction,
    },
  };
}

module.exports = {
  listGoalsForUser,
  getGoalAgentPreviewForUser,
  applyGoalRebalanceForUser,
  requireOwnedGoal,
};
