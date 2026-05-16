"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import Link from "next/link";
import Image from "next/image";
import { Circle, CircleCheck, Loader2, X } from "lucide-react";

type TaskStatus = "todo" | "doing" | "done";
type TaskPriority = "low" | "medium" | "high" | "urgent";

type Task = {
  id: string;
  title: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate: string | null;
  goalId?: string | null;
  completedAt?: string | null;
};

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: "bg-gray-200 text-gray-700",
  medium: "bg-blue-100 text-blue-700",
  high: "bg-orange-100 text-orange-700",
  urgent: "bg-red-100 text-red-700",
};

export default function DashboardPage() {
  const [goals, setGoals] = useState<any[]>([]);
  const [goalsError, setGoalsError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [statusLoading, setStatusLoading] = useState<string | null>(null);
  const [showPlan, setShowPlan] = useState(false);
  const [streak, setStreak] = useState<number | null>(null);
  const [todayFocusMinutes, setTodayFocusMinutes] = useState<number | null>(null);

  const fetchTodayTasks = useCallback(async () => {
    setTasksLoading(true);
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    try {
      const data = await api(
        `/tasks?startDate=${start.toISOString()}&endDate=${end.toISOString()}&includeOverdue=true`
      );
      const nextTasks: Task[] = Array.isArray(data) ? data : [];
      setTasks(nextTasks);
    } catch {
      setTasks([]);
    } finally {
      setTasksLoading(false);
    }
  }, []);

  const toggleStatus = async (id: string, current: TaskStatus) => {
    const next = current === "done" ? "todo" : "done";
    setStatusLoading(id);
    try {
      const updated = await api(`/tasks/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...updated } : t)));
    } catch { /* silent */ }
    finally { setStatusLoading(null); }
  };

  useEffect(() => {
    setGoalsError(null);
    setTasksLoading(true);
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    const tzOffsetMinutes = new Date().getTimezoneOffset();

    Promise.all([
      api("/goals").catch((err) => {
        console.error(err);
        setGoalsError(err instanceof Error ? err.message : "Failed to load goals");
        return [];
      }),
      api(
        `/tasks?startDate=${start.toISOString()}&endDate=${end.toISOString()}&includeOverdue=true`
      ).catch(() => []),
      api(`/focus/summary?tzOffsetMinutes=${tzOffsetMinutes}`).catch(() => null),
    ])
      .then(([goalsData, tasksData, focusData]) => {
        setGoals(Array.isArray(goalsData) ? goalsData : []);
        setTasks(Array.isArray(tasksData) ? tasksData : []);
        if (focusData && typeof focusData.streak === "number") setStreak(focusData.streak);
        if (focusData && typeof focusData.todayMinutes === "number") {
          setTodayFocusMinutes(focusData.todayMinutes);
        }
      })
      .finally(() => setTasksLoading(false));
  }, []);

  const formatFocusTime = (mins: number | null) => {
    if (mins == null) return "—";
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h <= 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  };

  const todayStart = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const todayEnd = new Date(todayStart);
  todayEnd.setHours(23, 59, 59, 999);

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const relevantTasks = tasks.filter((t) => {
    if (!t.dueDate) return false;
    const dueMs = new Date(t.dueDate).getTime();
    return dueMs <= todayEnd.getTime();
  });

  const completedTodayCount = relevantTasks.filter((t) => {
    if (t.status !== "done") return false;
    if (!t.completedAt) return false;
    const completedAt = new Date(t.completedAt);
    return isSameDay(completedAt, todayStart);
  }).length;

  const incompleteTodayAndOverdueCount = relevantTasks.filter(
    (t) => t.status !== "done"
  ).length;

  const progressPct =
    incompleteTodayAndOverdueCount > 0
      ? (completedTodayCount / incompleteTodayAndOverdueCount) * 100
      : relevantTasks.length > 0
        ? 100
        : 0;

  const activeTasks = tasks.filter((t) => t.status !== "done");
  const doneCount = completedTodayCount;
  const totalCount = incompleteTodayAndOverdueCount;

  return (
    <div className="ff-page flex flex-col">
      <main className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 sm:pt-10 pb-20 space-y-8 sm:space-y-10">
        {goalsError && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {goalsError}
          </div>
        )}
        {/* HERO */}
        <section className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-8 md:p-10 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="max-w-xl space-y-4">
            <h1 className="text-3xl font-semibold leading-tight">
              Stay consistent. Finish
              <br />
              what you start.
            </h1>
            <p className="text-gray-600">
              A calm space to plan your day, focus deeply,
              <br />
              and build momentum.
            </p>

            <div className="flex gap-3 pt-2">
              <Link
                href="/focus"
                className="bg-black text-white px-5 py-2 rounded-lg text-sm inline-flex items-center justify-center"
              >
                Start focus session
              </Link>
              <button
                type="button"
                onClick={() => setShowPlan(true)}
                className="border border-gray-200 px-5 py-2 rounded-lg text-sm inline-flex items-center justify-center hover:bg-gray-50 transition"
              >
                View today&#39;s plan
              </button>
            </div>
          </div>

          <Image
            src="/illustrations/dashboardImage.png"
            alt="Focus and plan your day"
            width={300}
            height={200}
            priority
            className="opacity-95 object-contain w-full max-w-[260px] sm:max-w-[300px] self-center md:self-auto md:-translate-x-4"
          />
        </section>

        {/* GRID */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* TODAY'S TASKS */}
          <div className="lg:col-span-2 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6 shadow-sm">
            <h2 className="text-lg font-semibold tracking-tight">Today&#39;s Tasks</h2>

            <div className="space-y-2 mt-3 text-sm">
              {tasksLoading ? (
                <div className="flex items-center gap-2 text-gray-500 py-4">
                  <Loader2 size={18} className="animate-spin" /> Loading…
                </div>
              ) : activeTasks.length === 0 ? (
                <p className="text-gray-500 py-4">No tasks for today. Add one from the tasks page.</p>
              ) : (
                activeTasks.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center gap-3 rounded-xl p-2 -mx-2 hover:bg-gray-50 transition"
                  >
                    <button
                      type="button"
                      onClick={() => toggleStatus(t.id, t.status)}
                      disabled={statusLoading === t.id}
                      aria-label={t.status === "done" ? "Mark not done" : "Mark done"}
                      className="shrink-0"
                    >
                      {statusLoading === t.id ? (
                        <Loader2 size={20} className="animate-spin text-gray-400" />
                      ) : t.status === "done" ? (
                        <CircleCheck size={20} className="text-green-600" />
                      ) : (
                        <Circle size={20} className="text-gray-400" />
                      )}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${t.status === "done" ? "text-gray-400 line-through" : ""}`}>
                        {t.title}
                      </p>
                      {t.dueDate && (() => {
                        const d = new Date(t.dueDate);
                        if (d.getHours() === 0 && d.getMinutes() === 0) return null;
                        return (
                          <p className="text-xs text-gray-500">
                            {d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                          </p>
                        );
                      })()}
                      {t.dueDate && new Date(t.dueDate).getTime() < todayStart.getTime() && (
                        <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold bg-red-100 text-red-700 uppercase">
                          Overdue
                        </span>
                      )}
                    </div>
                    <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${PRIORITY_COLORS[t.priority] ?? ""}`}>
                      {t.priority}
                    </span>
                  </div>
                ))
              )}
            </div>

            <div className="flex gap-3 mt-6">
              <Link href="/focus" className="bg-black text-white px-4 py-2 rounded-lg text-sm">
                Start focus session
              </Link>
              <Link href="/tasks" className="border border-gray-200 px-4 py-2 rounded-lg text-sm">
                Add task
              </Link>
            </div>
          </div>

          {/* PROGRESS */}
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm space-y-5">
            <h2 className="text-lg font-semibold tracking-tight">Your Progress</h2>

            <div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-emerald-600 transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <p className="text-sm mt-2">
                {doneCount} completed today / {totalCount} remaining (today + overdue)
              </p>
            </div>

            <div className="flex justify-between text-sm">
              <div>
                <p className="text-gray-500">Streak</p>
                <p className="font-medium">
                  {streak == null ? "—" : streak === 1 ? "1 day" : `${streak} days`}
                </p>
              </div>
              <div>
                <p className="text-gray-500">Focus time</p>
                <p className="font-medium">{formatFocusTime(todayFocusMinutes)}</p>
              </div>
            </div>

            <p className="text-xs text-gray-500">
              {totalCount === 0
                ? "No incomplete tasks due today (including overdue)."
                : doneCount === totalCount
                  ? "All your tasks for today (including overdue) are completed — great work!"
                  : "Keep going — every completed task builds momentum."}
            </p>
          </div>
        </section>

        {/* QUICK ACTIONS */}
        <section className="mt-6 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold tracking-tight">Quick Actions</h2>
            <span className="text-xs uppercase tracking-[0.18em] text-gray-400">
              Today
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Create Goal */}
            <Link
              href="/goals#goal-planner"
              className="group flex flex-col items-start justify-between rounded-2xl border border-gray-200 bg-[#F9F9F9] px-4 py-3 text-left transition hover:-translate-y-[1px] hover:border-gray-300 hover:shadow-sm"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 text-xs font-medium">
                  G
                </div>
                <div>
                  <p className="text-sm font-medium">Create Goal</p>
                  <p className="text-xs text-gray-500">Plan a deadline</p>
                </div>
              </div>
              <span className="mt-2 text-[11px] text-gray-400 group-hover:text-gray-500">
                Set a north star for your work
              </span>
            </Link>

            {/* Generate Plan */}
            <Link
              href="/goals#goal-planner"
              className="group flex flex-col items-start justify-between rounded-2xl border border-gray-200 bg-[#F9F9F9] px-4 py-3 text-left transition hover:-translate-y-[1px] hover:border-gray-300 hover:shadow-sm"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 text-xs font-medium">
                  P
                </div>
                <div>
                  <p className="text-sm font-medium">Generate Plan</p>
                  <p className="text-xs text-gray-500">Split work into days</p>
                </div>
              </div>
              <span className="mt-2 text-[11px] text-gray-400 group-hover:text-gray-500">
                Auto-create tasks from your goal
              </span>
            </Link>

            {/* Start Focus */}
            <Link
              href="/focus"
              className="group flex flex-col items-start justify-between rounded-2xl border border-gray-200 bg-[#F9F9F9] px-4 py-3 text-left transition hover:-translate-y-[1px] hover:border-gray-300 hover:shadow-sm"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 text-xs font-medium">
                  ⏱
                </div>
                <div>
                  <p className="text-sm font-medium">Start Focus</p>
                  <p className="text-xs text-gray-500">Track a deep-work block</p>
                </div>
              </div>
              <span className="mt-2 text-[11px] text-gray-400 group-hover:text-gray-500">
                Log a 25–60 minute session
              </span>
            </Link>

            {/* Journal Entry */}
            <Link
              href="/journal"
              className="group flex flex-col items-start justify-between rounded-2xl border border-gray-200 bg-[#F9F9F9] px-4 py-3 text-left transition hover:-translate-y-[1px] hover:border-gray-300 hover:shadow-sm"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 text-xs font-medium">
                  ✎
                </div>
                <div>
                  <p className="text-sm font-medium">Journal Entry</p>
                  <p className="text-xs text-gray-500">What worked today?</p>
                </div>
              </div>
              <span className="mt-2 text-[11px] text-gray-400 group-hover:text-gray-500">
                Capture one win + one lesson
              </span>
            </Link>
          </div>
        </section>
      </main>

      {/* Today's Plan Sheet Overlay */}
      {showPlan && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-10 sm:pt-14 p-4"
          onClick={() => setShowPlan(false)}
        >
          {/* Blurred backdrop */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-md" />

          {/* Paper sheet */}
          <div
            className="relative w-full max-w-lg max-h-[85vh] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-8 pt-8 pb-4 border-b border-gray-100">
              <div>
                <h2 className="text-xl font-semibold tracking-tight">Today&#39;s Plan</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPlan(false)}
                className="rounded-full p-2 hover:bg-gray-100 transition text-gray-400 hover:text-black"
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>

            {/* Task list */}
            <div className="flex-1 overflow-y-auto px-8 py-6">
              {tasksLoading ? (
                <div className="flex items-center justify-center gap-2 text-gray-500 py-10">
                  <Loader2 size={20} className="animate-spin" /> Loading…
                </div>
              ) : tasks.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-gray-400 text-sm">No tasks for today.</p>
                  <Link
                    href="/tasks"
                    className="inline-block mt-3 text-sm font-medium text-black underline underline-offset-2 hover:text-gray-700"
                    onClick={() => setShowPlan(false)}
                  >
                    Add a task
                  </Link>
                </div>
              ) : (
                <ul className="space-y-1">
                  {activeTasks.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => toggleStatus(t.id, t.status)}
                        disabled={statusLoading === t.id}
                        className="w-full flex items-start gap-3 rounded-xl px-3 py-3 text-left hover:bg-gray-50 transition"
                      >
                        <span className="shrink-0 mt-0.5">
                          {statusLoading === t.id ? (
                            <Loader2 size={20} className="animate-spin text-gray-400" />
                          ) : t.status === "done" ? (
                            <CircleCheck size={20} className="text-green-600" />
                          ) : (
                            <Circle size={20} className="text-gray-300" />
                          )}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm leading-snug ${t.status === "done" ? "text-gray-400 line-through" : "text-black"}`}>
                            {t.title}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${PRIORITY_COLORS[t.priority] ?? ""}`}>
                              {t.priority}
                            </span>
                            {t.dueDate && (() => {
                              const d = new Date(t.dueDate);
                              if (d.getHours() === 0 && d.getMinutes() === 0) return null;
                              return (
                                <span className="text-[11px] text-gray-400">
                                  {d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                                </span>
                              );
                            })()}
                            {t.dueDate && new Date(t.dueDate).getTime() < todayStart.getTime() && (
                              <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold bg-red-100 text-red-700 uppercase">
                                Overdue
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Footer */}
            <div className="px-8 py-4 border-t border-gray-100 flex items-center justify-between">
              <p className="text-xs text-gray-400">
                {doneCount} completed today / {totalCount} remaining
              </p>
              <Link
                href="/tasks"
                className="text-xs font-medium text-black hover:underline"
                onClick={() => setShowPlan(false)}
              >
                Open Tasks page
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
