const { startOfDay } = require("./buildPlan");

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

function unitsForTask(task) {
  const s = task?.unitStart;
  const e = task?.unitEnd;
  if (Number.isInteger(s) && Number.isInteger(e) && e >= s) {
    return e - s + 1;
  }
  // Legacy fallback (no metadata): treat task as one planned unit.
  return 1;
}

function pickGoalStartDate(goal, tasks) {
  if (goal?.startDate) return startOfDay(goal.startDate);

  const withDueDates = (tasks || [])
    .map((t) => (t?.dueDate ? new Date(t.dueDate) : null))
    .filter((d) => d && !Number.isNaN(d.getTime()));

  if (withDueDates.length > 0) {
    const minMs = Math.min(...withDueDates.map((d) => d.getTime()));
    return startOfDay(new Date(minMs));
  }

  if (goal?.createdAt) return startOfDay(goal.createdAt);
  return startOfDay(new Date());
}

function evaluateGoalProgress({ goal, tasks, now = new Date() }) {
  const nowDay = startOfDay(now);
  const endDate = startOfDay(goal?.deadline || nowDay);
  const startDate = pickGoalStartDate(goal, tasks);

  const totalTasks = (tasks || []).length;
  const completedTasks = (tasks || []).filter((t) => t?.status === "done").length;
  const remainingTasks = totalTasks - completedTasks;

  const missedTasks = (tasks || []).filter((t) => {
    if (t?.status === "done") return false;
    if (!t?.dueDate) return false;
    const due = new Date(t.dueDate);
    if (Number.isNaN(due.getTime())) return false;
    return startOfDay(due).getTime() < nowDay.getTime();
  }).length;

  const totalUnits = (tasks || []).reduce((sum, t) => sum + unitsForTask(t), 0);
  const completedUnits = (tasks || [])
    .filter((t) => t?.status === "done")
    .reduce((sum, t) => sum + unitsForTask(t), 0);

  const completionRate = totalUnits > 0 ? completedUnits / totalUnits : 0;

  const timelineTotalMs = Math.max(endDate.getTime() - startDate.getTime(), 0);
  const elapsedMs = Math.min(
    Math.max(nowDay.getTime() - startDate.getTime(), 0),
    timelineTotalMs
  );
  const expectedProgress =
    timelineTotalMs === 0 ? (nowDay.getTime() >= endDate.getTime() ? 1 : 0) : elapsedMs / timelineTotalMs;
  const actualProgress = completionRate;

  const progressGap = expectedProgress - actualProgress;
  const behindSchedule = progressGap > 0.05;

  let status = "on_track";
  if (progressGap > 0.2) {
    status = "at_risk";
  } else if (progressGap > 0.05) {
    status = "slightly_behind";
  }

  return {
    totalTasks,
    completedTasks,
    missedTasks,
    remainingTasks,
    totalUnits,
    completedUnits,
    completionRate: round4(clamp01(completionRate)),
    expectedProgress: round4(clamp01(expectedProgress)),
    actualProgress: round4(clamp01(actualProgress)),
    behindSchedule,
    status,
  };
}

module.exports = {
  evaluateGoalProgress,
  unitsForTask,
};
