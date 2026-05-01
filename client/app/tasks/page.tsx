"use client";

import React, { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Plus,
  Circle,
  CircleCheck,
  Loader2,
  Trash2,
  Pencil,
  Check,
  X,
} from "lucide-react";

type ViewMode = "week" | "month" | "day";
type TaskStatus = "todo" | "doing" | "done";
type TaskPriority = "low" | "medium" | "high" | "urgent";

const PRIORITY_OPTIONS: { value: TaskPriority; label: string; color: string }[] = [
  { value: "low", label: "Low", color: "bg-gray-200 text-gray-700" },
  { value: "medium", label: "Medium", color: "bg-blue-100 text-blue-700" },
  { value: "high", label: "High", color: "bg-orange-100 text-orange-700" },
  { value: "urgent", label: "Urgent", color: "bg-red-100 text-red-700" },
];

type Task = {
  id: string;
  userId: string;
  goalId: string | null;
  title: string;
  estimatedMin: number | null;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate: string | null;
  completedAt: string | null;
  createdAt: string;
};

// ——— Date helpers ———
function startOfWeek(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday = 0
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfWeek(d: Date): Date {
  const s = startOfWeek(d);
  const e = new Date(s);
  e.setDate(e.getDate() + 6);
  e.setHours(23, 59, 59, 999);
  return e;
}

function startOfMonth(d: Date): Date {
  const date = new Date(d);
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfMonth(d: Date): Date {
  const date = new Date(d);
  date.setMonth(date.getMonth() + 1);
  date.setDate(0);
  date.setHours(23, 59, 59, 999);
  return date;
}

function startOfDay(d: Date): Date {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfDay(d: Date): Date {
  const date = new Date(d);
  date.setHours(23, 59, 59, 999);
  return date;
}

function toISODate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatShort(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function formatDayNum(d: Date): string {
  return d.getDate().toString();
}

function getWeekDays(weekStart: Date): Date[] {
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    days.push(d);
  }
  return days;
}

function getMonthDays(monthStart: Date): Date[] {
  const days: Date[] = [];
  const end = endOfMonth(monthStart);
  const d = new Date(monthStart);
  while (d <= end) {
    days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

// Pad month grid to start on Monday (0 = Sunday in getDay, so Monday = 1)
function getMonthGrid(monthStart: Date): (Date | null)[][] {
  const first = new Date(monthStart);
  const firstDay = first.getDay();
  const pad = firstDay === 0 ? 6 : firstDay - 1; // blanks before first day (Monday week)
  const days = getMonthDays(monthStart);
  const total = pad + days.length;
  const rows = Math.ceil(total / 7);
  const grid: (Date | null)[][] = [];
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    const row: (Date | null)[] = [];
    for (let c = 0; c < 7; c++) {
      if (r === 0 && c < pad) {
        row.push(null);
      } else if (idx < days.length) {
        row.push(days[idx++]);
      } else {
        row.push(null);
      }
    }
    grid.push(row);
  }
  return grid;
}

export default function TasksPage() {
  const [view, setView] = useState<ViewMode>("week");
  const [cursor, setCursor] = useState(() => new Date());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createLoading, setCreateLoading] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newPriority, setNewPriority] = useState<TaskPriority>("medium");
  const [newDueDate, setNewDueDate] = useState(() => toISODate(new Date()));
  const [newDueTime, setNewDueTime] = useState("");
  const [statusLoading, setStatusLoading] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [taskIdPendingDelete, setTaskIdPendingDelete] = useState<string | null>(null);

  const getRange = useCallback(() => {
    if (view === "week") {
      const start = startOfWeek(cursor);
      const end = endOfWeek(cursor);
      return { start, end };
    }
    if (view === "month") {
      const start = startOfMonth(cursor);
      const end = endOfMonth(cursor);
      return { start, end };
    }
    const start = startOfDay(cursor);
    const end = endOfDay(cursor);
    return { start, end };
  }, [view, cursor]);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { start, end } = getRange();
    const isDayViewToday =
      view === "day" && toISODate(startOfDay(cursor)) === toISODate(new Date());
    const includeOverdue = isDayViewToday ? "true" : "false";
    try {
      const data = await api(
        `/tasks?startDate=${start.toISOString()}&endDate=${end.toISOString()}&includeOverdue=${includeOverdue}`
      );
      let nextTasks: Task[] = Array.isArray(data) ? data : [];

      if (isDayViewToday) {
        const overdueGoalIds = Array.from(
          new Set(
            nextTasks
              .filter((t) => {
                if (!t.goalId) return false;
                if (t.status === "done") return false;
                if (!t.dueDate) return false;
                return new Date(t.dueDate).getTime() < start.getTime();
              })
              .map((t) => t.goalId as string)
          )
        );

        if (overdueGoalIds.length > 0) {
          await Promise.all(
            overdueGoalIds.map((gid) =>
              api(`/goals/${gid}/plan/refresh`, {
                method: "POST",
              }).catch(() => {})
            )
          );

          const refreshed = await api(
            `/tasks?startDate=${start.toISOString()}&endDate=${end.toISOString()}&includeOverdue=${includeOverdue}`
          );
          nextTasks = Array.isArray(refreshed) ? refreshed : [];
        }
      }

      setTasks(nextTasks);
    } catch (e: any) {
      setTasks([]);
      setError(e?.message || "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, [getRange, view, cursor]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const createTask = async () => {
    const title = newTitle.trim();
    if (!title) return;
    setCreateLoading(true);
    setError(null);
    let dueDate: string | null = null;
    if (newDueDate) {
      const dateStr = newDueTime ? `${newDueDate}T${newDueTime}` : `${newDueDate}T00:00`;
      dueDate = new Date(dateStr).toISOString();
    }
    try {
      const created = await api("/tasks", {
        method: "POST",
        body: JSON.stringify({
          title,
          priority: newPriority,
          dueDate: dueDate || undefined,
        }),
      });
      setTasks((prev) => [created, ...prev]);
      setNewTitle("");
      setNewPriority("medium");
      setNewDueDate(toISODate(new Date()));
      setNewDueTime("");
    } catch (e: any) {
      setError(e?.message || "Failed to create task");
    } finally {
      setCreateLoading(false);
    }
  };

  const updateStatus = async (id: string, status: TaskStatus) => {
    setStatusLoading(id);
    try {
      const updated = await api(`/tasks/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...updated } : t))
      );
    } catch (e: any) {
      setError(e?.message || "Failed to update");
    } finally {
      setStatusLoading(null);
    }
  };

  const deleteTask = async (id: string) => {
    try {
      await api(`/tasks/${id}`, {
        method: "DELETE",
      });
      setTasks((prev) => prev.filter((t) => t.id !== id));
    } catch (e: any) {
      setError(e?.message || "Failed to delete");
    }
  };

  const editTask = async (
    id: string,
    updates: { title?: string; priority?: TaskPriority; dueDate?: string | null }
  ) => {
    try {
      const updated = await api(`/tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify(updates),
      });
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...updated } : t)));
    } catch (e: any) {
      setError(e?.message || "Failed to update task");
    }
  };

  const goPrev = () => {
    const d = new Date(cursor);
    if (view === "week") d.setDate(d.getDate() - 7);
    else if (view === "month") d.setMonth(d.getMonth() - 1);
    else d.setDate(d.getDate() - 1);
    setCursor(d);
  };

  const goNext = () => {
    const d = new Date(cursor);
    if (view === "week") d.setDate(d.getDate() + 7);
    else if (view === "month") d.setMonth(d.getMonth() + 1);
    else d.setDate(d.getDate() + 1);
    setCursor(d);
  };

  const goToday = () => setCursor(new Date());

  const tasksByDate = (() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.dueDate) continue;
      const key = toISODate(new Date(t.dueDate));
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return map;
  })();

  const activeTasks = tasks.filter((t) => t.status !== "done");
  const completedTasks = tasks.filter((t) => t.status === "done");

  const todayStart = startOfDay(new Date());
  const showOverdue = view === "day" && toISODate(startOfDay(cursor)) === toISODate(new Date());
  const overdueCutoffMs = todayStart.getTime();

  const baseBtn =
    "rounded-2xl border border-gray-200 bg-[#F9F9F9] px-4 py-2.5 text-sm font-medium transition hover:border-gray-300 hover:shadow-sm";
  const activeBtn = "border-black bg-black text-white hover:bg-black/90";

  return (
    <div className="min-h-screen bg-white text-black">
      <main className="mx-auto max-w-6xl px-6 py-6 space-y-6">
        {/* Header card — same theme as dashboard/journal */}
        <section className="border rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
            <p className="text-gray-600 text-sm mt-0.5">
              View and manage tasks by week, month, or day.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={goToday}
              className="rounded-full border border-black/25 px-4 py-2 text-sm font-medium hover:bg-black/[0.06] transition"
            >
              Today
            </button>
          </div>
        </section>

        {/* View switcher + nav */}
        <section className="rounded-2xl border border-black/25 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex rounded-2xl border border-gray-200 bg-[#F9F9F9] p-1">
              {(["week", "month", "day"] as ViewMode[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={`capitalize ${baseBtn} ${view === v ? activeBtn : "border-transparent bg-transparent"}`}
                >
                  {v}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={goPrev}
                aria-label="Previous"
                className="rounded-full p-2 border border-black/25 hover:bg-black/[0.06] transition"
              >
                <ChevronLeft size={20} />
              </button>
              <span className="min-w-[180px] text-center text-sm font-medium">
                {view === "week" &&
                  `${formatShort(startOfWeek(cursor))} – ${formatShort(endOfWeek(cursor))}`}
                {view === "month" &&
                  cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                {view === "day" && formatShort(cursor)}
              </span>
              <button
                type="button"
                onClick={goNext}
                aria-label="Next"
                className="rounded-full p-2 border border-black/25 hover:bg-black/[0.06] transition"
              >
                <ChevronRight size={20} />
              </button>
            </div>
          </div>
        </section>

        {/* Week view: day strip + task list */}
        {view === "week" && (
          <section className="rounded-2xl border border-black/25 bg-white p-4">
            <div className="grid grid-cols-7 gap-2 mb-4">
              {getWeekDays(startOfWeek(cursor)).map((d) => {
                const key = toISODate(d);
                const isToday = toISODate(d) === toISODate(new Date());
                const dayTasks = tasksByDate.get(key) || [];
                return (
                  <div
                    key={key}
                    className={`rounded-xl border p-3 text-center ${isToday ? "border-black bg-black/[0.04]" : "border-gray-200 bg-[#F9F9F9]"}`}
                  >
                    <div className="text-[11px] uppercase text-gray-500">
                      {d.toLocaleDateString(undefined, { weekday: "short" })}
                    </div>
                    <div className="text-lg font-semibold mt-0.5">{formatDayNum(d)}</div>
                    <div className="text-xs text-gray-500 mt-1">{dayTasks.length} tasks</div>
                  </div>
                );
              })}
            </div>
            <div className="border-t border-gray-200 pt-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Tasks this week</h2>
              {loading ? (
                <div className="flex items-center gap-2 text-gray-500 py-6">
                  <Loader2 size={18} className="animate-spin" />
                  Loading…
                </div>
              ) : (
                <TaskList
                  tasks={activeTasks}
                  onStatus={updateStatus}
                  onDelete={(id) => setTaskIdPendingDelete(id)}
                  onEdit={editTask}
                  statusLoading={statusLoading}
                  showOverdue={showOverdue}
                  overdueCutoffMs={overdueCutoffMs}
                />
              )}
            </div>
          </section>
        )}

        {/* Month view: grid + task list for selected range */}
        {view === "month" && (
          <section className="rounded-2xl border border-black/25 bg-white p-4">
            <div className="grid grid-cols-7 gap-1 mb-2">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((w) => (
                <div key={w} className="text-center text-[11px] font-medium text-gray-500 py-1">
                  {w}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {getMonthGrid(startOfMonth(cursor)).flat().map((d, i) => {
                if (!d) return <div key={`empty-${i}`} className="min-h-[72px] rounded-lg bg-gray-50/50" />;
                const key = toISODate(d);
                const isToday = key === toISODate(new Date());
                const dayTasks = tasksByDate.get(key) || [];
                return (
                  <div
                    key={key}
                    className={`min-h-[72px] rounded-lg border p-2 ${isToday ? "border-black bg-black/[0.04]" : "border-gray-200 bg-[#F9F9F9]"}`}
                  >
                    <span className="text-sm font-medium">{formatDayNum(d)}</span>
                    {dayTasks.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-0.5">
                        {dayTasks.slice(0, 3).map((t) => (
                          <span
                            key={t.id}
                            className="inline-block max-w-full truncate rounded bg-black/10 px-1.5 py-0.5 text-[10px]"
                            title={t.title}
                          >
                            {t.title}
                          </span>
                        ))}
                        {dayTasks.length > 3 && (
                          <span className="text-[10px] text-gray-500">+{dayTasks.length - 3}</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="border-t border-gray-200 mt-4 pt-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Tasks this month</h2>
              {loading ? (
                <div className="flex items-center gap-2 text-gray-500 py-6">
                  <Loader2 size={18} className="animate-spin" />
                  Loading…
                </div>
              ) : (
                <TaskList
                  tasks={activeTasks}
                  onStatus={updateStatus}
                  onDelete={(id) => setTaskIdPendingDelete(id)}
                  onEdit={editTask}
                  statusLoading={statusLoading}
                  showOverdue={showOverdue}
                  overdueCutoffMs={overdueCutoffMs}
                />
              )}
            </div>
          </section>
        )}

        {/* Day view */}
        {view === "day" && (
          <section className="rounded-2xl border border-black/25 bg-white p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">
              Tasks for {formatShort(cursor)}
            </h2>
            {loading ? (
              <div className="flex items-center gap-2 text-gray-500 py-6">
                <Loader2 size={18} className="animate-spin" />
                Loading…
              </div>
            ) : (
              <TaskList
                tasks={activeTasks}
                onStatus={updateStatus}
                onDelete={(id) => setTaskIdPendingDelete(id)}
                onEdit={editTask}
                statusLoading={statusLoading}
                  showOverdue={showOverdue}
                  overdueCutoffMs={overdueCutoffMs}
              />
            )}
          </section>
        )}

        {/* Completed tasks dropdown */}
        <section className="rounded-2xl border border-black/25 bg-white p-4">
          <button
            type="button"
            onClick={() => setShowCompleted((v) => !v)}
            className="flex w-full items-center justify-between text-sm font-medium text-gray-700"
          >
            <div className="flex items-center gap-2">
              <ChevronDown
                size={16}
                className={`transition-transform ${showCompleted ? "rotate-180" : ""}`}
              />
              <span>Completed tasks</span>
            </div>
            <span className="text-xs text-gray-500">
              {completedTasks.length} {completedTasks.length === 1 ? "task" : "tasks"}
            </span>
          </button>
          {showCompleted && (
            <div className="mt-3">
              {completedTasks.length === 0 ? (
                <p className="text-xs text-gray-500">No completed tasks yet.</p>
              ) : (
                <ul className="space-y-2">
                  {completedTasks.map((t) => (
                    <li
                      key={t.id}
                      className="flex items-center gap-3 rounded-xl border border-gray-200 bg-[#F3F3F3] px-4 py-3 text-sm text-gray-600"
                    >
                      <span className="line-through flex-1 min-w-0">{t.title}</span>
                      {t.dueDate && (
                        <span className="text-[11px] text-gray-400 shrink-0">
                          {formatDueDateTime(t.dueDate)}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => setTaskIdPendingDelete(t.id)}
                        aria-label="Delete completed task"
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition"
                      >
                        <Trash2 size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        {/* Add task */}
        <section className="rounded-2xl border border-black/25 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Add task</h2>
          {error && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          )}
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Task title…"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createTask()}
                className="flex-1 rounded-xl border border-gray-200 bg-[#F9F9F9] px-4 py-2.5 text-sm placeholder:text-gray-400 focus:border-black/40 focus:outline-none"
              />
              <button
                type="button"
                onClick={createTask}
                disabled={createLoading || !newTitle.trim()}
                className="rounded-full bg-black text-white px-5 py-2.5 text-sm font-medium hover:bg-black/90 transition disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-2"
              >
                {createLoading ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Plus size={18} />
                )}
                Add
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <label htmlFor="new-priority" className="text-xs font-medium text-gray-500">Priority</label>
                <div className="flex rounded-lg border border-gray-200 bg-[#F9F9F9] p-0.5">
                  {PRIORITY_OPTIONS.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setNewPriority(p.value)}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                        newPriority === p.value ? p.color : "text-gray-400 hover:text-gray-600"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="new-due-date" className="text-xs font-medium text-gray-500">Due</label>
                <input
                  id="new-due-date"
                  type="date"
                  value={newDueDate}
                  onChange={(e) => setNewDueDate(e.target.value)}
                  className="rounded-lg border border-gray-200 bg-[#F9F9F9] px-3 py-1.5 text-sm focus:border-black/40 focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="new-due-time" className="text-xs font-medium text-gray-500">Time</label>
                <input
                  id="new-due-time"
                  type="time"
                  value={newDueTime}
                  onChange={(e) => setNewDueTime(e.target.value)}
                  className="rounded-lg border border-gray-200 bg-[#F9F9F9] px-3 py-1.5 text-sm focus:border-black/40 focus:outline-none"
                />
                {newDueTime && (
                  <button
                    type="button"
                    onClick={() => setNewDueTime("")}
                    className="text-xs text-gray-400 hover:text-gray-600"
                  >
                    clear
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>
      </main>

      <ConfirmDialog
        open={taskIdPendingDelete !== null}
        title="Are you sure?"
        message="This permanently deletes the task. You can't undo this."
        confirmLabel="Delete task"
        onCancel={() => setTaskIdPendingDelete(null)}
        onConfirm={() => {
          const id = taskIdPendingDelete;
          setTaskIdPendingDelete(null);
          if (id) void deleteTask(id);
        }}
      />
    </div>
  );
}

function priorityColor(p: TaskPriority): string {
  return PRIORITY_OPTIONS.find((o) => o.value === p)?.color ?? "bg-gray-200 text-gray-700";
}

function formatDueDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const h = d.getHours();
  const m = d.getMinutes();
  if (h === 0 && m === 0) return date;
  return `${date}, ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

function parseDueDate(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  const date = toISODate(d);
  const h = d.getHours();
  const m = d.getMinutes();
  const time = h === 0 && m === 0 ? "" : `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return { date, time };
}

function TaskList({
  tasks,
  onStatus,
  onDelete,
  onEdit,
  statusLoading,
  showOverdue,
  overdueCutoffMs,
}: {
  tasks: Task[];
  onStatus: (id: string, status: TaskStatus) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string, updates: { title?: string; priority?: TaskPriority; dueDate?: string | null }) => Promise<void>;
  statusLoading: string | null;
  showOverdue: boolean;
  overdueCutoffMs: number;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editPriority, setEditPriority] = useState<TaskPriority>("medium");
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [saving, setSaving] = useState(false);

  const startEdit = (t: Task) => {
    setEditingId(t.id);
    setEditTitle(t.title);
    setEditPriority(t.priority);
    const { date, time } = parseDueDate(t.dueDate);
    setEditDate(date);
    setEditTime(time);
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = async (id: string) => {
    if (!editTitle.trim()) return;
    setSaving(true);
    let dueDate: string | null = null;
    if (editDate) {
      const dateStr = editTime ? `${editDate}T${editTime}` : `${editDate}T00:00`;
      dueDate = new Date(dateStr).toISOString();
    }
    await onEdit(id, { title: editTitle.trim(), priority: editPriority, dueDate });
    setSaving(false);
    setEditingId(null);
  };

  if (tasks.length === 0) {
    return (
      <p className="text-sm text-gray-500 py-4">No tasks in this range. Add one below.</p>
    );
  }
  return (
    <ul className="space-y-2">
      {tasks.map((t) => {
        const isEditing = editingId === t.id;

        if (isEditing) {
          return (
            <li
              key={t.id}
              className="rounded-xl border border-black/30 bg-white px-4 py-3 space-y-3"
            >
              <div className="flex gap-2">
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveEdit(t.id); if (e.key === "Escape") cancelEdit(); }}
                  className="flex-1 rounded-lg border border-gray-200 bg-[#F9F9F9] px-3 py-1.5 text-sm focus:border-black/40 focus:outline-none"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => saveEdit(t.id)}
                  disabled={saving || !editTitle.trim()}
                  className="rounded-lg bg-black text-white px-3 py-1.5 text-xs font-medium hover:bg-black/90 transition disabled:opacity-60 inline-flex items-center gap-1"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  Save
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition inline-flex items-center gap-1"
                >
                  <X size={14} />
                  Cancel
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-500">Priority</span>
                  <div className="flex rounded-lg border border-gray-200 bg-[#F9F9F9] p-0.5">
                    {PRIORITY_OPTIONS.map((p) => (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => setEditPriority(p.value)}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                          editPriority === p.value ? p.color : "text-gray-400 hover:text-gray-600"
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-500">Due</span>
                  <input
                    type="date"
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="rounded-lg border border-gray-200 bg-[#F9F9F9] px-3 py-1 text-sm focus:border-black/40 focus:outline-none"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-500">Time</span>
                  <input
                    type="time"
                    value={editTime}
                    onChange={(e) => setEditTime(e.target.value)}
                    className="rounded-lg border border-gray-200 bg-[#F9F9F9] px-3 py-1 text-sm focus:border-black/40 focus:outline-none"
                  />
                  {editTime && (
                    <button type="button" onClick={() => setEditTime("")} className="text-xs text-gray-400 hover:text-gray-600">
                      clear
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        }

        return (
          <li
            key={t.id}
            className="flex items-center gap-3 rounded-xl border border-gray-200 bg-[#F9F9F9] px-4 py-3 group"
          >
            <button
              type="button"
              onClick={() => onStatus(t.id, t.status === "done" ? "todo" : "done")}
              disabled={statusLoading === t.id}
              className="shrink-0"
              aria-label={t.status === "done" ? "Mark not done" : "Mark done"}
            >
              {statusLoading === t.id ? (
                <Loader2 size={20} className="animate-spin text-gray-400" />
              ) : t.status === "done" ? (
                <CircleCheck size={22} className="text-green-600" />
              ) : (
                <Circle size={22} className="text-gray-400" />
              )}
            </button>
            <span
              className={`flex-1 min-w-0 text-sm ${t.status === "done" ? "text-gray-500 line-through" : "font-medium"}`}
            >
              {t.title}
            </span>
            <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${priorityColor(t.priority)}`}>
              {t.priority}
            </span>
            {t.dueDate && (
              <span className="text-xs text-gray-500 shrink-0">
                {formatDueDateTime(t.dueDate)}
              </span>
            )}
            {showOverdue && t.dueDate && new Date(t.dueDate).getTime() < overdueCutoffMs && (
              <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold bg-red-100 text-red-700 uppercase">
                Overdue
              </span>
            )}
            <button
              type="button"
              onClick={() => startEdit(t)}
              aria-label="Edit task"
              className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-gray-400 hover:text-black hover:bg-gray-100 transition"
            >
              <Pencil size={16} />
            </button>
            <button
              type="button"
              onClick={() => onDelete(t.id)}
              aria-label="Delete task"
              className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition"
            >
              <Trash2 size={16} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
