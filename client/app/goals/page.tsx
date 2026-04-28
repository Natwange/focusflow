"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { api } from "@/lib/api";
import { ChevronDown, Pencil, Trash2, RefreshCw } from "lucide-react";

type PlanItem = {
  dueDate: string;
  title: string;
  unitsPlanned: number;
};

export default function GoalsPage() {
  const todayKey = new Date().toISOString().slice(0, 10);

  const [title, setTitle] = useState("");
  const [totalUnits, setTotalUnits] = useState<string>("");
  const [unitName, setUnitName] = useState("lessons");
  const [startDate, setStartDate] = useState<string>(todayKey);
  const [deadline, setDeadline] = useState("");
  const [creating, setCreating] = useState(false);
  const [weightsRaw, setWeightsRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PlanItem[] | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  type GoalTask = {
    id: string;
    title: string;
    dueDate: string | null;
    status: "todo" | "doing" | "done";
  };

  type Goal = {
    id: string;
    title: string;
    totalUnits: number;
    unitName: string;
    deadline: string;
    tasks: GoalTask[];
  };

  const [goalsLoading, setGoalsLoading] = useState(false);
  const [goalsList, setGoalsList] = useState<Goal[]>([]);
  const [expandedGoalIds, setExpandedGoalIds] = useState<Record<string, boolean>>({});
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [showPlansDropdown, setShowPlansDropdown] = useState(true);

  const [editTitle, setEditTitle] = useState("");
  const [editTotalUnits, setEditTotalUnits] = useState<string>("");
  const [editUnitName, setEditUnitName] = useState<string>("");
  const [editDeadline, setEditDeadline] = useState<string>("");

  const toDateInput = (iso: string) => {
    const d = new Date(iso);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const loadGoals = useCallback(async () => {
    setGoalsLoading(true);
    try {
      const data = await api("/goals");
      setGoalsList(Array.isArray(data) ? data : []);
    } catch {
      setGoalsList([]);
    } finally {
      setGoalsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGoals();
  }, [loadGoals]);

  const canSubmit =
    title.trim().length > 0 &&
    Number(totalUnits) > 0 &&
    unitName.trim().length > 0 &&
    startDate.trim().length > 0 &&
    deadline.trim().length > 0;

  function parseWeights(): number[] | null {
    if (!weightsRaw.trim()) return null;
    const parts = weightsRaw.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return null;

    const mapping: Record<string, number> = {
      short: 1,
      s: 1,
      medium: 2,
      m: 2,
      long: 3,
      l: 3,
      "very long": 4,
      xl: 4,
    };

    const weights: number[] = parts.map((p) => {
      const lower = p.toLowerCase();
      if (mapping[lower] != null) return mapping[lower];
      const n = Number(p);
      return Number.isFinite(n) && n > 0 ? n : 1;
    });

    return weights;
  }

  async function handleCreateGoal(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || creating) return;

    setError(null);
    setSuccessMsg(null);
    setPreview(null);

    setCreating(true);
    try {
      const weights = parseWeights();

      // 1) Create the goal
      const goal = await api("/goals", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          totalUnits: Number(totalUnits),
          unitName: unitName.trim(),
          deadline: new Date(deadline).toISOString(),
        }),
      });

      // 2) Ask backend to build a day‑by‑day plan
      const previewData = await api(`/goals/${goal.id}/plan/preview`, {
        method: "POST",
        body: JSON.stringify({ weights, startDate }),
      });

      const items: PlanItem[] = previewData.items ?? [];
      setPreview(items);

      if (items.length === 0) {
        setError("Could not generate a plan for this goal.");
        return;
      }

      // 3) Confirm the plan: this creates actual tasks tied to the goal
      await api(`/goals/${goal.id}/plan/confirm`, {
        method: "POST",
        body: JSON.stringify({ items }),
      });

      setSuccessMsg(
        `Plan created: ${items.length} days of ${unitName} added as tasks.`
      );
      await loadGoals();
      // Optionally clear inputs for the next goal
      setTitle("");
      setTotalUnits("");
      setDeadline("");
    } catch (e: any) {
      setError(e?.message || "Failed to create goal");
    } finally {
      setCreating(false);
    }
  }

  const toggleGoalTaskStatus = async (taskId: string, current: GoalTask["status"]) => {
    const next = current === "done" ? "todo" : "done";
    await api(`/tasks/${taskId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: next }),
    });
    await loadGoals();
  };

  const deleteGoal = async (goalId: string) => {
    await api(`/goals/${goalId}`, {
      method: "DELETE",
    });
    await loadGoals();
  };

  const refreshGoalPlan = async (goalId: string) => {
    await api(`/goals/${goalId}/plan/refresh`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    await loadGoals();
  };

  const startDateFromGoal = (goal: Goal) => {
    const dueDates = goal.tasks
      .map((t) => t.dueDate)
      .filter(Boolean) as string[];
    if (dueDates.length === 0) return new Date().toISOString();
    const min = new Date(Math.min(...dueDates.map((d) => new Date(d).getTime())));
    return min.toISOString();
  };

  const startReplanFromEdit = async (goalId: string) => {
    const goal = goalsList.find((g) => g.id === goalId);
    if (!goal) return;

    await api(`/goals/${goalId}`, {
      method: "PUT",
      body: JSON.stringify({
        title: editTitle.trim(),
        totalUnits: Number(editTotalUnits),
        unitName: editUnitName.trim(),
        deadline: new Date(editDeadline).toISOString(),
      }),
    });

    await api(`/goals/${goalId}/tasks`, {
      method: "DELETE",
    });

    const startDateIso = startDateFromGoal(goal);
    const previewData = await api(`/goals/${goalId}/plan/preview`, {
      method: "POST",
      body: JSON.stringify({ weights: null, startDate: startDateIso }),
    });

    const items: PlanItem[] = previewData.items ?? [];
    if (!items.length) return;

    await api(`/goals/${goalId}/plan/confirm`, {
      method: "POST",
      body: JSON.stringify({ items }),
    });

    setEditingGoalId(null);
    await loadGoals();
  };

  return (
    <div className="min-h-screen bg-white text-black flex flex-col">
      <main className="w-full max-w-6xl mx-auto px-6 pt-10 pb-20 space-y-10">
        {/* HERO */}
        <section className="border border-gray-200 rounded-2xl p-10 flex items-center justify-between">
          <div className="max-w-xl space-y-4">
            <h1 className="text-3xl font-semibold leading-tight">
              Small steps. Big trajectory.
            </h1>
            <p className="text-gray-600">
              Turn big goals into daily tasks.
              <br />
              Tell FocusFlow your target and let it schedule the work.
            </p>
            <button
              type="button"
              onClick={() => {
                const el = document.getElementById("goal-planner");
                if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className="mt-2 inline-flex items-center rounded-lg bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/90"
            >
              Generate a plan
            </button>

            <button
              type="button"
              onClick={() => {
                setShowPlansDropdown(true);
                const el = document.getElementById("saved-plans");
                if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className="mt-2 inline-flex items-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-black hover:bg-gray-50"
            >
              View plans
            </button>
          </div>

          <Image
            src="/illustrations/better astronaut image.png"
            alt="Small steps. Big trajectory."
            width={360}
            height={240}
            className="opacity-90 contrast-150 md:-translate-x-16 object-contain"
          />
        </section>

        {/* Goal planner form */}
        <section id="goal-planner" className="border border-gray-200 rounded-2xl p-8 space-y-6">
          <h2 className="text-xl font-semibold tracking-tight">
            Set goals, build discipline
          </h2>

          <form
            onSubmit={handleCreateGoal}
            className="grid grid-cols-1 md:grid-cols-2 gap-6"
          >
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                Goal name
              </label>
              <input
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-black focus:ring-2 focus:ring-black/10"
                placeholder="Finish 30‑day JavaScript course"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700 flex items-center justify-between">
                Total units
                <span className="text-xs text-gray-500">
                  e.g. 30 lessons, 10 chapters
                </span>
              </label>
              <input
                type="number"
                min={1}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-black focus:ring-2 focus:ring-black/10"
                value={totalUnits}
                onChange={(e) => setTotalUnits(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                Unit name
              </label>
              <input
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-black focus:ring-2 focus:ring-black/10"
                placeholder="lessons, chapters, sessions…"
                value={unitName}
                onChange={(e) => setUnitName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                Start date
              </label>
              <input
                type="date"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-black focus:ring-2 focus:ring-black/10"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-gray-700 flex items-center justify-between">
                Optional: unit sizes
                <span className="text-xs text-gray-500">
                  e.g. short, long, medium,… or 1,2,3
                </span>
              </label>
              <input
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-black focus:ring-2 focus:ring-black/10"
                placeholder="Example for 4 chapters: short, long, medium, medium"
                value={weightsRaw}
                onChange={(e) => setWeightsRaw(e.target.value)}
              />
              <p className="text-xs text-gray-500">
                If you leave this empty, FocusFlow spreads units evenly. If you fill it,
                earlier entries map to earlier units (chapter 1, chapter 2, …).
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                Target finish date
              </label>
              <input
                type="date"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-black focus:ring-2 focus:ring-black/10"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </div>

            <div className="md:col-span-2 flex items-center justify-between pt-2">
              <div className="space-y-1">
                {error && (
                  <p className="text-sm text-red-600">{error}</p>
                )}
                {successMsg && (
                  <p className="text-sm text-emerald-600">{successMsg}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={!canSubmit || creating}
                className="rounded-lg bg-black px-5 py-2.5 text-sm font-medium text-white hover:bg-black/90 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {creating ? "Planning…" : "Create goal & tasks"}
              </button>
            </div>
          </form>

          {preview && preview.length > 0 && (
            <div className="mt-4 rounded-lg bg-gray-50 border border-gray-200 p-4 text-sm text-gray-700 space-y-2">
              <p className="font-medium">
                First few planned days
              </p>
              <ul className="list-disc pl-5 space-y-1">
                {preview.slice(0, 5).map((item, idx) => (
                  <li key={idx}>
                    <span className="font-medium">
                      {new Date(item.dueDate).toLocaleDateString()}
                    </span>
                    {": "}
                    {item.title}
                  </li>
                ))}
                {preview.length > 5 && (
                  <li className="text-gray-500">
                    …and {preview.length - 5} more days planned.
                  </li>
                )}
              </ul>
            </div>
          )}
        </section>

        {/* Saved plans */}
        <section id="saved-plans" className="space-y-3">
          <button
            type="button"
            onClick={() => setShowPlansDropdown((v) => !v)}
            className="flex w-full items-center justify-between rounded-2xl border border-black/25 bg-white p-4 text-left"
          >
            <div className="flex items-center gap-3">
              <ChevronDown
                size={18}
                className={`transition-transform ${showPlansDropdown ? "rotate-180" : ""}`}
              />
              <div>
                <div className="text-xl font-semibold tracking-tight">Your plans</div>
                <div className="text-xs text-gray-500">
                  {goalsList.length === 0 ? "No plans created yet." : "Click a plan to expand its breakdown."}
                </div>
              </div>
            </div>
            <div className="text-xs text-gray-500 shrink-0">
              {goalsList.length}
            </div>
          </button>

          {showPlansDropdown && (
            <>
              {goalsLoading ? (
                <div className="text-sm text-gray-500">Loading plans…</div>
              ) : goalsList.length === 0 ? (
                <div className="text-sm text-gray-500">No plans created yet.</div>
              ) : (
                <div className="space-y-3">
                  {goalsList.map((g) => {
                const isExpanded = expandedGoalIds[g.id] === true;
                const tasksSorted = [...(g.tasks || [])].sort((a, b) => {
                  const ad = a.dueDate ? new Date(a.dueDate).getTime() : 0;
                  const bd = b.dueDate ? new Date(b.dueDate).getTime() : 0;
                  return ad - bd;
                });
                const activeCount = tasksSorted.filter((t) => t.status !== "done").length;
                return (
                  <div key={g.id} className="border border-gray-200 rounded-2xl p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-lg font-semibold truncate">{g.title}</p>
                        <p className="text-sm text-gray-500">
                          Deadline: {toDateInput(g.deadline)}
                          {" • "}
                          {activeCount} active steps
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedGoalIds((prev) => ({ ...prev, [g.id]: !isExpanded }))
                          }
                          className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm hover:bg-gray-50 transition"
                        >
                          <ChevronDown
                            size={16}
                            className={isExpanded ? "rotate-180 transition" : "transition"}
                          />
                          {isExpanded ? "Hide" : "View plan"}
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            setEditingGoalId((prev) => {
                              const next = prev === g.id ? null : g.id;
                              if (next) {
                                setEditTitle(g.title);
                                setEditTotalUnits(String(g.totalUnits));
                                setEditUnitName(g.unitName);
                                setEditDeadline(toDateInput(g.deadline));
                              }
                              return next;
                            })
                          }
                          className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm hover:bg-gray-50 transition"
                          aria-label="Edit goal"
                        >
                          <Pencil size={16} />
                        </button>

                        <button
                          type="button"
                          onClick={() => refreshGoalPlan(g.id)}
                          className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm hover:bg-gray-50 transition"
                          aria-label="Rebalance plan"
                        >
                          <RefreshCw size={16} />
                        </button>

                        <button
                          type="button"
                          onClick={() => deleteGoal(g.id)}
                          className="inline-flex items-center rounded-full border border-red-200 bg-white px-3 py-1.5 text-sm hover:bg-red-50 transition"
                          aria-label="Delete goal"
                        >
                          <Trash2 size={16} className="text-red-600" />
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="mt-4 space-y-3">
                        <ul className="space-y-2">
                          {tasksSorted.length === 0 ? (
                            <li className="text-sm text-gray-500">No tasks in this plan.</li>
                          ) : (
                            tasksSorted.map((t) => (
                              <li
                                key={t.id}
                                className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 ${
                                  t.status === "done" ? "bg-gray-50" : "bg-[#F9F9F9]"
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() => toggleGoalTaskStatus(t.id, t.status)}
                                  className="flex-1 text-left min-w-0"
                                >
                                  <div className={`text-sm font-medium truncate ${t.status === "done" ? "line-through text-gray-500" : ""}`}>
                                    {t.title}
                                  </div>
                                  <div className="text-xs text-gray-500">
                                    {t.dueDate ? toDateInput(t.dueDate) : "No due date"}
                                  </div>
                                </button>
                                <span
                                  className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${
                                    t.status === "done"
                                      ? "bg-green-100 text-green-700"
                                      : "bg-gray-200 text-gray-700"
                                  }`}
                                >
                                  {t.status}
                                </span>
                              </li>
                            ))
                          )}
                        </ul>
                      </div>
                    )}

                    {editingGoalId === g.id && (
                      <div className="mt-4 border border-gray-200 rounded-2xl p-4 bg-white space-y-3">
                        <p className="text-sm font-medium text-gray-800">
                          Edit plan
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-xs text-gray-500">Title</label>
                            <input
                              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none"
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-gray-500">Total units</label>
                            <input
                              type="number"
                              min={1}
                              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none"
                              value={editTotalUnits}
                              onChange={(e) => setEditTotalUnits(e.target.value)}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-gray-500">Unit name</label>
                            <input
                              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none"
                              value={editUnitName}
                              onChange={(e) => setEditUnitName(e.target.value)}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-gray-500">Deadline</label>
                            <input
                              type="date"
                              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none"
                              value={editDeadline}
                              onChange={(e) => setEditDeadline(e.target.value)}
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingGoalId(null);
                            }}
                            className="rounded-lg border border-gray-200 px-4 py-2 text-sm hover:bg-gray-50"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => startReplanFromEdit(g.id)}
                            className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/90"
                          >
                            Save & re-plan
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
                  })}
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
