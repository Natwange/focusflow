/**
 * Planned units for one goal-linked task (chunk). Matches server rebalance / evaluation rules:
 * prefer unitStart–unitEnd; else parse trailing range from title; else 1.
 */
export function parseTrailingUnitRange(
  t: string | null | undefined
): { unitsPlanned: number } | null {
  if (!t || typeof t !== "string") return null;
  const m = t.trim().match(/(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2] ? Number(m[2]) : start;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return { unitsPlanned: end - start + 1 };
}

export function unitsPlannedForTask(task: {
  title: string;
  unitStart?: number | null;
  unitEnd?: number | null;
}): number {
  const s = task.unitStart;
  const e = task.unitEnd;
  if (
    s != null &&
    e != null &&
    Number.isInteger(s) &&
    Number.isInteger(e) &&
    e >= s
  ) {
    return e - s + 1;
  }
  const parsed = parseTrailingUnitRange(task.title);
  if (parsed) return parsed.unitsPlanned;
  return 1;
}

export function sumCompletedUnits<
  T extends { status: string; title: string; unitStart?: number | null; unitEnd?: number | null },
>(tasks: T[]): number {
  return tasks
    .filter((t) => t.status === "done")
    .reduce((sum, t) => sum + unitsPlannedForTask(t), 0);
}
