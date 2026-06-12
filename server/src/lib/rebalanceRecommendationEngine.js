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

function taskContentStart(task) {
  if (Number.isInteger(task?.unitStart)) return task.unitStart;
  return Number.MAX_SAFE_INTEGER;
}

function canPlaceOnDay(dayLoadUnits, idx, units, dailyCap) {
  return idx >= 0 && idx < dayLoadUnits.length && dayLoadUnits[idx] + units <= dailyCap;
}

function placeOnDay(dayLoadUnits, idx, units) {
  dayLoadUnits[idx] += units;
  return idx;
}

/**
 * Assign due dates in curriculum order (unitStart ascending).
 * Earlier sections always land on the same day or before later sections.
 */
function assignContentOrderedSchedule({
  tasks,
  eligibleDates,
  dayIndexByKey,
  dayLoadUnits,
  dailyCap,
  nowDay,
}) {
  const sorted = [...tasks].sort(compareTasks);
  const assigned = new Map();
  let lastAssignedIdx = -1;

  for (const task of sorted) {
    const units = unitsForTask(task);
    const due = parseDateOrNull(task.dueDate);
    const isMissed =
      due != null && startOfDay(due).getTime() < nowDay.getTime();
    const originalKey = due ? dayKey(due) : null;
    const originalIdx =
      originalKey != null ? dayIndexByKey.get(originalKey) : undefined;

    const minIdx = Math.max(0, lastAssignedIdx);

    let placedIdx = -1;

    // Prefer keeping a future task on its current date when order and capacity allow.
    if (
      !isMissed &&
      originalIdx != null &&
      originalIdx >= minIdx &&
      canPlaceOnDay(dayLoadUnits, originalIdx, units, dailyCap)
    ) {
      placedIdx = placeOnDay(dayLoadUnits, originalIdx, units);
    } else {
      for (let i = minIdx; i < eligibleDates.length; i++) {
        if (canPlaceOnDay(dayLoadUnits, i, units, dailyCap)) {
          placedIdx = placeOnDay(dayLoadUnits, i, units);
          break;
        }
      }
    }

    if (placedIdx < 0) {
      return { ok: false, assigned };
    }

    assigned.set(task.id, placedIdx);
    lastAssignedIdx = placedIdx;
  }

  return { ok: true, assigned };
}

function actionForImpossible(goal) {
  // Deadlines are flexible by default unless goal explicitly marks strictDeadline=true.
  if (goal?.strictDeadline === true) return "reduce_scope";
  return "extend_deadline";
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
      reason:
        "The current deadline does not include enough available work days to place remaining tasks.",
      recommendedAction: actionForImpossible(goal),
      proposedSchedule: [],
      changes: [],
      warnings,
    };
  }

  if (requiredUnits > capacityUnits) {
    return {
      canRebalance: false,
      reason:
        `The current deadline does not include enough available work days: ` +
        `${requiredUnits} units remain, but only ${capacityUnits} units fit before the deadline.`,
      recommendedAction: actionForImpossible(goal),
      proposedSchedule: [],
      changes: [],
      warnings,
    };
  }

  const dayLoadUnits = Array.from({ length: eligibleDates.length }, () => 0);
  const orderedCandidates = [...missedTasks, ...futureTasks].sort(compareTasks);

  const placement = assignContentOrderedSchedule({
    tasks: orderedCandidates,
    eligibleDates,
    dayIndexByKey,
    dayLoadUnits,
    dailyCap,
    nowDay,
  });

  if (!placement.ok) {
    return {
      canRebalance: false,
      reason:
        "Unable to reschedule remaining sections in learning order before the deadline. " +
        "Consider extending the deadline so earlier sections stay before later ones.",
      recommendedAction: actionForImpossible(goal),
      proposedSchedule: [],
      changes: [],
      warnings: [
        ...warnings,
        "Rebalance preserves section order (earlier units before later units).",
      ],
    };
  }

  const assigned = placement.assigned;

  const proposedSchedule = [];
  const changes = [];
  for (const task of orderedCandidates) {
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
      const contentStart = taskContentStart(task);
      changes.push({
        taskId: task.id,
        from: oldDueIso,
        to: newDueDate,
        unitStart: Number.isInteger(task.unitStart) ? task.unitStart : null,
        unitEnd: Number.isInteger(task.unitEnd) ? task.unitEnd : null,
        reason: missed
          ? `Rescheduled missed section (unit ${contentStart}) while keeping learning order.`
          : "Shifted to keep section order and daily capacity within the deadline.",
      });
    }
  }

  const recommendedAction = changes.length > 0 ? "rebalance" : "keep_plan";
  const canRebalance = recommendedAction === "rebalance";

  return {
    canRebalance,
    reason: canRebalance
      ? "A feasible rebalance is available that keeps earlier sections before later ones."
      : "No task date changes are needed after evaluating current incomplete work.",
    recommendedAction,
    proposedSchedule,
    changes,
    warnings,
    contentOrderPreserved: true,
  };
}

module.exports = {
  recommendRebalance,
  compareTasks,
  assignContentOrderedSchedule,
};
