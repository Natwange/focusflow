const { startOfDay } = require("./buildPlan");
const { unitsForTask } = require("./evaluationEngine");

const DAY_CODES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const DEFAULT_DAILY_CAP = 3;

function parseDateOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
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
    const code = String(day || "").trim().toUpperCase();
    const idx = DAY_CODES.indexOf(code);
    if (idx >= 0) out.add(idx);
  }
  return out.size > 0 ? out : new Set([0, 1, 2, 3, 4, 5, 6]);
}

function resolveDailyCap(goal) {
  const n = Number(goal?.maxTasksPerDay ?? goal?.maxUnitsPerDay);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_DAILY_CAP;
  return Math.floor(n);
}

function shouldKeepPlan(failureAnalysis) {
  const modes = Array.isArray(failureAnalysis?.failureModes)
    ? failureAnalysis.failureModes
    : [];
  return modes.length === 0 || (modes.length === 1 && modes[0] === "no_failure_detected");
}

function buildEligibleDates({ nowDay, deadlineDay, availableDays }) {
  if (!deadlineDay || nowDay.getTime() > deadlineDay.getTime()) return [];
  const dates = [];
  for (
    let t = nowDay.getTime();
    t <= deadlineDay.getTime();
    t += 24 * 60 * 60 * 1000
  ) {
    const d = new Date(t);
    if (availableDays.has(d.getUTCDay())) dates.push(d);
  }
  return dates;
}

function dayKey(dateLike) {
  return startOfDay(dateLike).toISOString().slice(0, 10);
}

function compareTasks(a, b) {
  const aStart = Number.isInteger(a?.unitStart) ? a.unitStart : Number.MAX_SAFE_INTEGER;
  const bStart = Number.isInteger(b?.unitStart) ? b.unitStart : Number.MAX_SAFE_INTEGER;
  if (aStart !== bStart) return aStart - bStart;

  const aDue = parseDateOrNull(a?.dueDate);
  const bDue = parseDateOrNull(b?.dueDate);
  const aDueMs = aDue ? aDue.getTime() : Number.MAX_SAFE_INTEGER;
  const bDueMs = bDue ? bDue.getTime() : Number.MAX_SAFE_INTEGER;
  if (aDueMs !== bDueMs) return aDueMs - bDueMs;

  return String(a?.id || "").localeCompare(String(b?.id || ""));
}

function actionForImpossible(failureAnalysis) {
  const modes = new Set(failureAnalysis?.failureModes || []);
  if (modes.has("not_enough_available_days")) return "extend_deadline";
  if (modes.has("too_many_missed_tasks")) return "reduce_scope";
  return "manual_review";
}

function recommendRebalance({
  goal,
  tasks,
  evaluation,
  failureAnalysis,
  now = new Date(),
}) {
  if (shouldKeepPlan(failureAnalysis)) {
    return {
      canRebalance: false,
      reason: "No failure mode detected; current schedule can be kept.",
      recommendedAction: "keep_plan",
      proposedSchedule: [],
      changes: [],
      warnings: [],
    };
  }

  const nowDay = startOfDay(now);
  const deadline = parseDateOrNull(goal?.deadline);
  const deadlineDay = deadline ? startOfDay(deadline) : null;
  const availableDays = normalizeAvailableDays(goal?.availableDays);
  const dailyCap = resolveDailyCap(goal);

  if (!deadlineDay) {
    return {
      canRebalance: false,
      reason: "Goal deadline is missing or invalid.",
      recommendedAction: "manual_review",
      proposedSchedule: [],
      changes: [],
      warnings: ["Goal deadline is invalid; cannot compute rebalance window."],
    };
  }

  const warnings = [];
  const candidates = [];
  for (const task of tasks || []) {
    if (task?.status === "done") continue;
    const due = parseDateOrNull(task?.dueDate);
    if (!due) {
      warnings.push(`Task ${task?.id || "(unknown)"} has invalid dueDate and was skipped.`);
      continue;
    }
    candidates.push(task);
  }

  const missedTasks = [];
  const futureTasks = [];
  for (const t of candidates) {
    const due = parseDateOrNull(t.dueDate);
    if (!due) continue;
    if (startOfDay(due).getTime() < nowDay.getTime()) {
      missedTasks.push(t);
    } else {
      futureTasks.push(t);
    }
  }
  missedTasks.sort(compareTasks);
  futureTasks.sort(compareTasks);

  const eligibleDates = buildEligibleDates({ nowDay, deadlineDay, availableDays });
  const eligibleDayKeys = eligibleDates.map((d) => dayKey(d));
  const dayIndexByKey = new Map(eligibleDayKeys.map((k, idx) => [k, idx]));

  const requiredUnits = candidates.reduce((sum, t) => sum + unitsForTask(t), 0);
  const capacityUnits = eligibleDates.length * dailyCap;

  if (eligibleDates.length === 0) {
    return {
      canRebalance: false,
      reason: "No available days remain between today and deadline.",
      recommendedAction: actionForImpossible(failureAnalysis),
      proposedSchedule: [],
      changes: [],
      warnings,
    };
  }

  if (requiredUnits > capacityUnits) {
    return {
      canRebalance: false,
      reason:
        `Remaining incomplete work (${requiredUnits} units) exceeds available capacity ` +
        `(${capacityUnits} units) before deadline.`,
      recommendedAction: actionForImpossible(failureAnalysis),
      proposedSchedule: [],
      changes: [],
      warnings,
    };
  }

  const hasDistributionProblem = new Set(failureAnalysis?.failureModes || []).has(
    "task_distribution_problem"
  );
  const dayLoadUnits = Array.from({ length: eligibleDates.length }, () => 0);
  const assigned = new Map();
  const pendingFuture = [];

  // Keep future tasks on original day by default.
  for (const task of futureTasks) {
    const units = unitsForTask(task);
    const due = parseDateOrNull(task.dueDate);
    const key = due ? dayKey(due) : null;
    const idx = key != null ? dayIndexByKey.get(key) : undefined;

    if (idx == null) {
      // Day is outside allowed window or unavailable.
      pendingFuture.push(task);
      continue;
    }

    if (!hasDistributionProblem && dayLoadUnits[idx] + units <= dailyCap) {
      dayLoadUnits[idx] += units;
      assigned.set(task.id, idx);
      continue;
    }

    pendingFuture.push(task);
  }

  function placeTask(task, preferredStartIndex = 0, allowEarlierFallback = false) {
    const units = unitsForTask(task);
    for (let i = preferredStartIndex; i < eligibleDates.length; i++) {
      if (dayLoadUnits[i] + units <= dailyCap) {
        dayLoadUnits[i] += units;
        return i;
      }
    }
    if (allowEarlierFallback) {
      for (let i = preferredStartIndex - 1; i >= 0; i--) {
        if (dayLoadUnits[i] + units <= dailyCap) {
          dayLoadUnits[i] += units;
          return i;
        }
      }
    }
    return -1;
  }

  // 1) Prefer placing missed tasks into open capacity first.
  for (const task of missedTasks) {
    const idx = placeTask(task, 0, false);
    if (idx < 0) {
      return {
        canRebalance: false,
        reason: "Unable to place missed tasks into available future capacity.",
        recommendedAction: actionForImpossible(failureAnalysis),
        proposedSchedule: [],
        changes: [],
        warnings,
      };
    }
    assigned.set(task.id, idx);
  }

  // 2) Place only necessary future tasks; avoid earlier moves unless unavoidable.
  for (const task of pendingFuture) {
    const due = parseDateOrNull(task.dueDate);
    const preferredKey = due ? dayKey(due) : null;
    const preferredIdx =
      preferredKey != null && dayIndexByKey.has(preferredKey)
        ? dayIndexByKey.get(preferredKey)
        : 0;

    let idx = placeTask(task, preferredIdx, false);
    if (idx < 0) {
      // Absolutely necessary fallback to earlier movement.
      idx = placeTask(task, preferredIdx, true);
      if (idx >= 0) {
        warnings.push(
          `Task ${task.id || "(unknown)"} was moved earlier because later capacity was exhausted.`
        );
      }
    }

    if (idx < 0) {
      return {
        canRebalance: false,
        reason: "Unable to fit remaining tasks into available days with current constraints.",
        recommendedAction: actionForImpossible(failureAnalysis),
        proposedSchedule: [],
        changes: [],
        warnings,
      };
    }
    assigned.set(task.id, idx);
  }

  const proposedSchedule = [];
  const changes = [];
  for (const task of [...missedTasks, ...futureTasks]) {
    const idx = assigned.get(task.id);
    if (idx == null) continue;
    const newDueDate = eligibleDates[idx].toISOString();
    const oldDue = parseDateOrNull(task.dueDate);
    const oldDueIso = oldDue ? oldDue.toISOString() : null;

    proposedSchedule.push({
      taskId: task.id,
      title: task.title,
      oldDueDate: oldDueIso,
      newDueDate,
      unitStart: Number.isInteger(task.unitStart) ? task.unitStart : null,
      unitEnd: Number.isInteger(task.unitEnd) ? task.unitEnd : null,
    });

    if (oldDueIso !== newDueDate) {
      const missed = oldDue && startOfDay(oldDue).getTime() < nowDay.getTime();
      changes.push({
        taskId: task.id,
        from: oldDueIso,
        to: newDueDate,
        reason: missed
          ? "Rescheduled missed task into next available day."
          : "Redistributed future incomplete workload for balance.",
      });
    }
  }

  const recommendedAction = changes.length > 0 ? "rebalance" : "keep_plan";
  const canRebalance = recommendedAction === "rebalance";

  return {
    canRebalance,
    reason: canRebalance
      ? "A feasible rebalance schedule is available within the current deadline."
      : "No task date changes are needed after evaluating current incomplete work.",
    recommendedAction,
    proposedSchedule,
    changes,
    warnings,
  };
}

module.exports = {
  recommendRebalance,
};
