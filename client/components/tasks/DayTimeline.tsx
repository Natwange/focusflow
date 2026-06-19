"use client";

import {
  Circle,
  CircleCheck,
  Loader2,
  Pencil,
  Trash2,
} from "lucide-react";
import { taskDueCalendarDayKey } from "@/lib/calendarDueDate";
import {
  DAY_TIMELINE_HOUR_HEIGHT_PX,
  formatHourLabel,
  formatScheduleRange,
  isTaskScheduled,
  minutesFromMidnightLocal,
} from "@/lib/taskSchedule";

type TaskPriority = "low" | "medium" | "high" | "urgent";
type TaskStatus = "todo" | "doing" | "done";

export type DayTimelineTask = {
  id: string;
  title: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate: string | null;
  startTime: string | null;
  endTime: string | null;
};

const PRIORITY_BORDER: Record<TaskPriority, string> = {
  low: "border-l-slate-400",
  medium: "border-l-sky-500",
  high: "border-l-amber-500",
  urgent: "border-l-red-500",
};

const HOURS = Array.from({ length: 24 }, (_, i) => i);
/** Space above 12 AM so the label isn't clipped by the card edge */
const TIMELINE_TOP_PAD = 14;

type DayTimelineProps = {
  tasks: DayTimelineTask[];
  dayKey: string;
  showOverdue: boolean;
  todayKey: string;
  onStatus: (id: string, status: TaskStatus) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  statusLoading: string | null;
};

function taskBelongsOnDay(task: DayTimelineTask, dayKey: string): boolean {
  const anchor = task.dueDate || task.startTime;
  if (!anchor) return false;
  return taskDueCalendarDayKey(anchor) === dayKey;
}

export function DayTimeline({
  tasks,
  dayKey,
  showOverdue,
  todayKey,
  onStatus,
  onEdit,
  onDelete,
  statusLoading,
}: DayTimelineProps) {
  const dayTasks = tasks.filter((t) => taskBelongsOnDay(t, dayKey));
  const scheduled = dayTasks.filter((t) => isTaskScheduled(t));
  const unscheduled = dayTasks.filter((t) => !isTaskScheduled(t));

  const overdueUnscheduled = unscheduled.filter((t) => {
    if (!showOverdue || !t.dueDate) return false;
    const key = taskDueCalendarDayKey(t.dueDate);
    return key != null && key < todayKey;
  });
  const regularUnscheduled = unscheduled.filter(
    (t) => !overdueUnscheduled.includes(t)
  );

  return (
    <div className="space-y-6">
      {(overdueUnscheduled.length > 0 || regularUnscheduled.length > 0) && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">
            Anytime today
          </h3>
          {overdueUnscheduled.length > 0 && (
            <ul className="space-y-2">
              {overdueUnscheduled.map((t) => (
                <UnscheduledTaskRow
                  key={t.id}
                  task={t}
                  overdue
                  onStatus={onStatus}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  statusLoading={statusLoading}
                />
              ))}
            </ul>
          )}
          {regularUnscheduled.length > 0 ? (
            <ul className="space-y-2">
              {regularUnscheduled.map((t) => (
                <UnscheduledTaskRow
                  key={t.id}
                  task={t}
                  onStatus={onStatus}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  statusLoading={statusLoading}
                />
              ))}
            </ul>
          ) : overdueUnscheduled.length === 0 ? (
            <p className="text-sm text-gray-500">No unscheduled tasks for this day.</p>
          ) : null}
        </div>
      )}

      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">
          Schedule
        </h3>
        <div className="rounded-xl border border-gray-200 bg-[#FAFAFA]/60">
          <div
            className="flex"
            style={{ height: TIMELINE_TOP_PAD + 24 * DAY_TIMELINE_HOUR_HEIGHT_PX }}
          >
            <div className="w-14 sm:w-16 shrink-0 border-r border-gray-200 bg-white/80 flex flex-col">
              <div style={{ height: TIMELINE_TOP_PAD }} aria-hidden />
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  className="relative border-b border-gray-100 last:border-b-0 text-[10px] sm:text-xs text-gray-400 pr-1 text-right"
                  style={{ height: DAY_TIMELINE_HOUR_HEIGHT_PX }}
                >
                  <span
                    className={`absolute right-1 tabular-nums leading-none ${
                      hour === 0 ? "top-0" : "-top-2"
                    }`}
                  >
                    {formatHourLabel(hour)}
                  </span>
                </div>
              ))}
            </div>

            <div
              className="relative flex-1 min-w-0"
              style={{ height: TIMELINE_TOP_PAD + 24 * DAY_TIMELINE_HOUR_HEIGHT_PX }}
            >
              <div style={{ height: TIMELINE_TOP_PAD }} aria-hidden />
              <div
                className="relative"
                style={{ height: 24 * DAY_TIMELINE_HOUR_HEIGHT_PX }}
              >
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  className="absolute left-0 right-0 border-b border-gray-100 pointer-events-none"
                  style={{
                    top: hour * DAY_TIMELINE_HOUR_HEIGHT_PX,
                    height: DAY_TIMELINE_HOUR_HEIGHT_PX,
                  }}
                />
              ))}

              {scheduled.length === 0 && (
                <p className="absolute inset-0 flex items-center justify-center text-sm text-gray-400 px-4 text-center">
                  No timed tasks — add start and end times to see blocks here.
                </p>
              )}

              {scheduled.map((task) => {
                const startMin = minutesFromMidnightLocal(task.startTime!);
                const endMin = minutesFromMidnightLocal(task.endTime!);
                const top = (startMin / 60) * DAY_TIMELINE_HOUR_HEIGHT_PX;
                const height = Math.max(
                  ((endMin - startMin) / 60) * DAY_TIMELINE_HOUR_HEIGHT_PX,
                  28
                );

                return (
                  <div
                    key={task.id}
                    className={`absolute left-1 right-1 sm:left-2 sm:right-2 rounded-lg border border-gray-200 bg-white shadow-sm border-l-4 ${PRIORITY_BORDER[task.priority]} overflow-hidden`}
                    style={{ top, height }}
                  >
                    <div className="flex h-full items-start gap-1.5 px-2 py-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          onStatus(task.id, task.status === "done" ? "todo" : "done")
                        }
                        disabled={statusLoading === task.id}
                        className="shrink-0 mt-0.5"
                        aria-label="Toggle complete"
                      >
                        {statusLoading === task.id ? (
                          <Loader2 size={14} className="animate-spin text-gray-400" />
                        ) : task.status === "done" ? (
                          <CircleCheck size={14} className="text-green-600" />
                        ) : (
                          <Circle size={14} className="text-gray-400" />
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs sm:text-sm font-semibold text-gray-900 truncate leading-tight">
                          {task.title}
                        </p>
                        <p className="text-[10px] text-gray-500 tabular-nums">
                          {formatScheduleRange(task.startTime!, task.endTime!)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onEdit(task.id)}
                        className="shrink-0 p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                        aria-label="Edit"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(task.id)}
                        className="shrink-0 p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
                        aria-label="Delete"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function UnscheduledTaskRow({
  task,
  overdue,
  onStatus,
  onEdit,
  onDelete,
  statusLoading,
}: {
  task: DayTimelineTask;
  overdue?: boolean;
  onStatus: (id: string, status: TaskStatus) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  statusLoading: string | null;
}) {
  return (
    <li className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm">
      <button
        type="button"
        onClick={() => onStatus(task.id, task.status === "done" ? "todo" : "done")}
        disabled={statusLoading === task.id}
        className="shrink-0"
      >
        {statusLoading === task.id ? (
          <Loader2 size={18} className="animate-spin text-gray-400" />
        ) : task.status === "done" ? (
          <CircleCheck size={18} className="text-green-600" />
        ) : (
          <Circle size={18} className="text-gray-400" />
        )}
      </button>
      <span className="flex-1 min-w-0 font-medium text-gray-900 truncate">
        {task.title}
      </span>
      {overdue && (
        <span className="text-[11px] font-semibold text-red-700 shrink-0">Overdue</span>
      )}
      <button
        type="button"
        onClick={() => onEdit(task.id)}
        className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-gray-800 hover:bg-gray-100"
      >
        <Pencil size={14} />
      </button>
      <button
        type="button"
        onClick={() => onDelete(task.id)}
        className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"
      >
        <Trash2 size={14} />
      </button>
    </li>
  );
}
