const { startOfDay } = require("./buildPlan");
const { unitsForTask } = require("./evaluationEngine");

const DAY_CODES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const DEFAULT_MAX_TASKS_PER_DAY = 3;

function isDone(task) {
  return task?.status === "done";
}

function parseDateOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dayKeyUTC(dateLike) {
  return startOfDay(dateLike).toISOString().slice(0, 10);
}

function resolveMaxTasksPerDay(goal) {
  const raw = goal?.maxTasksPerDay ?? goal?.maxUnitsPerDay;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_TASKS_PER_DAY;
  return Math.floor(n);
}

function normalizeAvailableDays(availableDays) {
  if (!Array.isArray(availableDays) || availableDays.length === 0) {
    return new Set([0, 1, 2, 3, 4, 5, 6]);
  }

  const out = new Set();
  for (const day of availableDays) {
    if (Number.isInteger(day) && day >= 0 && day <= 6) {
      out.add(day);
      continue;
    }
    const text = String(day || "").trim().toUpperCase();
    const idx = DAY_CODES.indexOf(text);
    if (idx >= 0) out.add(idx);
  }

  return out.size > 0 ? out : new Set([0, 1, 2, 3, 4, 5, 6]);
}

function getRemainingUnits(tasks) {
  return (tasks || [])
    .filter((t) => !isDone(t))
    .reduce((sum, t) => sum + unitsForTask(t), 0);
}

function countFutureAvailableDays({ start, deadline, availableDaySet }) {
  if (!start || !deadline) return 0;
  const startDay = startOfDay(start);
  const endDay = startOfDay(deadline);
  if (startDay.getTime() > endDay.getTime()) return 0;

  let count = 0;
  for (
    let t = startDay.getTime();
    t <= endDay.getTime();
    t += 24 * 60 * 60 * 1000
  ) {
    const day = new Date(t);
    if (availableDaySet.has(day.getUTCDay())) count++;
  }
  return count;
}

function countFutureIncompleteTasksByDay({ tasks, nowDay, deadlineDay }) {
  const map = new Map();
  for (const task of tasks || []) {
    if (isDone(task)) continue;
    const due = parseDateOrNull(task?.dueDate);
    if (!due) continue;
    const dueDay = startOfDay(due);
    if (dueDay.getTime() < nowDay.getTime()) continue;
    if (deadlineDay && dueDay.getTime() > deadlineDay.getTime()) continue;
    const key = dayKeyUTC(dueDay);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

function detectFailureModes({ goal, tasks, evaluation, now = new Date() }) {
  const failureModes = [];
  const nowDay = startOfDay(now);
  const maxTasksPerDay = resolveMaxTasksPerDay(goal);
  const availableDaySet = normalizeAvailableDays(goal?.availableDays);
  const deadline = parseDateOrNull(goal?.deadline);
  const deadlineDay = deadline ? startOfDay(deadline) : null;

  const incompleteByDueDay = new Map();
  for (const task of tasks || []) {
    if (isDone(task)) continue;
    const due = parseDateOrNull(task?.dueDate);
    if (!due) continue;
    const key = dayKeyUTC(due);
    incompleteByDueDay.set(key, (incompleteByDueDay.get(key) || 0) + 1);
  }
  const hasOverloadedDay = [...incompleteByDueDay.values()].some(
    (count) => count > maxTasksPerDay
  );
  if (hasOverloadedDay) {
    failureModes.push("overloaded_day");
  }

  const totalTasks = Number(evaluation?.totalTasks) || 0;
  const missedTasks = Number(evaluation?.missedTasks) || 0;
  const missedRatio = totalTasks > 0 ? missedTasks / totalTasks : 0;
  if (missedTasks >= 3 || missedRatio >= 0.3) {
    failureModes.push("too_many_missed_tasks");
  }

  if (evaluation?.behindSchedule === true) {
    failureModes.push("behind_schedule");
  }

  const remainingUnits = getRemainingUnits(tasks || []);
  const futureAvailableDays = countFutureAvailableDays({
    start: nowDay,
    deadline: deadlineDay,
    availableDaySet,
  });
  const estimatedCapacity = futureAvailableDays * maxTasksPerDay;
  if (remainingUnits > estimatedCapacity) {
    failureModes.push("not_enough_available_days");
  }

  const futureByDay = countFutureIncompleteTasksByDay({
    tasks,
    nowDay,
    deadlineDay,
  });
  if (futureByDay.size > 0) {
    const loads = [...futureByDay.values()];
    const maxLoad = Math.max(...loads);
    const hasEmptyFutureAvailableDays = futureAvailableDays > futureByDay.size;
    const strongSkew = loads.length >= 2 && maxLoad >= 2 * (loads.reduce((a, b) => a + b, 0) / loads.length);

    if (
      (maxLoad > maxTasksPerDay && hasEmptyFutureAvailableDays) ||
      (hasEmptyFutureAvailableDays && strongSkew)
    ) {
      failureModes.push("task_distribution_problem");
    }
  }

  if (failureModes.length === 0) {
    return {
      failureModes: ["no_failure_detected"],
      primaryFailureMode: "no_failure_detected",
      explanation: "No significant scheduling failure mode detected.",
      severity: "low",
    };
  }

  const severityOrder = {
    high: ["not_enough_available_days", "too_many_missed_tasks"],
    medium: ["behind_schedule", "task_distribution_problem"],
    low: ["overloaded_day"],
  };

  let severity = "low";
  if (failureModes.some((m) => severityOrder.high.includes(m))) {
    severity = "high";
  } else if (failureModes.some((m) => severityOrder.medium.includes(m))) {
    severity = "medium";
  }

  const primaryFailureMode =
    severityOrder.high.find((m) => failureModes.includes(m)) ||
    severityOrder.medium.find((m) => failureModes.includes(m)) ||
    severityOrder.low.find((m) => failureModes.includes(m)) ||
    failureModes[0];

  const explanationByMode = {
    overloaded_day:
      "At least one day has more incomplete tasks than the daily task threshold.",
    too_many_missed_tasks:
      "Missed tasks are high in absolute count or relative share of total tasks.",
    behind_schedule:
      "Actual goal progress is trailing expected progress for this point in time.",
    not_enough_available_days:
      "Remaining work exceeds estimated capacity across available days before the deadline.",
    task_distribution_problem:
      "Future work is unevenly spread across days, with overloads and unused availability.",
  };

  return {
    failureModes,
    primaryFailureMode,
    explanation: explanationByMode[primaryFailureMode],
    severity,
  };
}

module.exports = {
  detectFailureModes,
};
