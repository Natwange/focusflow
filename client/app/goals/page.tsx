"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { api } from "@/lib/api";
import { onAgentMutation, emitAgentMutation } from "@/lib/agentEvents";
import { sumCompletedUnits } from "@/lib/goalTaskUnits";
import { taskDueCalendarDayKey } from "@/lib/calendarDueDate";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ChevronDown, Pencil, Trash2, RefreshCw, X } from "lucide-react";

type PlanItem = {
  dueDate: string;
  title: string;
  unitsPlanned: number;
};

type DeadlineRiskLevel = "on_track" | "at_risk" | "impossible";

type PreviewPlanning = {
  riskLevel: DeadlineRiskLevel;
  requiredUnitsPerDay: number;
  eligibleDays: number;
};

type RebalanceStrategy =
  | "keep_deadline"
  | "spread_evenly"
  | "increase_daily_load"
  | "extend_deadline";

type RebalanceOption = {
  strategy: RebalanceStrategy;
  label: string;
  description: string;
  estimatedDailyLoad: number;
  newDeadline: string | null;
  feasible: boolean;
  suggestedMaxUnitsPerDay?: number | null;
};

type RebalancePreviewResponse = {
  isBehind: boolean;
  completedUnits: number;
  expectedUnitsByToday: number;
  remainingUnits: number;
  options: RebalanceOption[];
};

/** Response from GET /goals/:id/agent-preview */
type AgentPreviewResponse = {
  goalId: string;
  agentRunId: string;
  evaluation: {
    status?: string;
    completionRate?: number;
    [key: string]: unknown;
  };
  failureAnalysis: {
    primaryFailureMode?: string;
    severity?: string;
    failureModes?: string[];
    [key: string]: unknown;
  };
  rebalanceRecommendation: {
    canRebalance?: boolean;
    reason?: string;
    recommendedAction?: string;
    warnings?: string[];
    [key: string]: unknown;
  };
  recommendation: string;
  recommendationSegments?: Array<{ text: string; emphasis?: boolean }>;
  nextAction: string;
};

const AGENT_FAILURE_LABELS: Record<string, string> = {
  no_failure_detected: "None detected",
  overloaded_day: "Overloaded days",
  too_many_missed_tasks: "Many missed tasks",
  behind_schedule: "Behind schedule",
  not_enough_available_days: "Not enough days before deadline",
  task_distribution_problem: "Uneven distribution",
};

const AGENT_STATUS_LABELS: Record<string, string> = {
  on_track: "On track",
  slightly_behind: "Slightly behind",
  at_risk: "At risk",
};

const AGENT_SEVERITY_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

const AGENT_STATUS_TONE_CLASSES: Record<string, string> = {
  on_track: "text-emerald-700",
  slightly_behind: "text-amber-700",
  at_risk: "text-red-700",
};

function formatAgentLabel(raw: string | undefined): string {
  if (!raw) return "—";
  return raw.replace(/_/g, " ");
}

function formatAgentFailureMode(raw: string | undefined): string {
  if (!raw) return "—";
  return AGENT_FAILURE_LABELS[raw] ?? formatAgentLabel(raw);
}

function formatAgentStatus(raw: string | undefined): string {
  if (!raw) return "—";
  return AGENT_STATUS_LABELS[raw] ?? formatAgentLabel(raw);
}

function formatAgentSeverity(raw: string | undefined): string {
  if (!raw) return "—";
  return AGENT_SEVERITY_LABELS[raw] ?? formatAgentLabel(raw);
}

function statusToneClass(raw: string | undefined): string {
  if (!raw) return "text-gray-900";
  return AGENT_STATUS_TONE_CLASSES[raw] ?? "text-gray-900";
}

function formatNextAction(raw: string | undefined): string {
  if (raw === "keep_plan") return "Keep current plan";
  if (raw === "extend_deadline") return "Extend deadline";
  if (raw === "reduce_scope") return "Reduce scope";
  if (raw === "manual_review") return "Review manually";
  if (!raw) return "—";
  return formatAgentLabel(raw);
}

function recommendationFromStatus(raw: string | undefined): string {
  if (raw === "on_track") return "You're on track. Keep your current pace.";
  if (raw === "slightly_behind") {
    return "You're slightly behind. Consider adjusting your pace.";
  }
  if (raw === "at_risk") {
    return "You're at risk of missing your goal. Action is recommended.";
  }
  return "Review your current goal state and adjust your next step.";
}

function riskLevelLabel(level: DeadlineRiskLevel): string {
  switch (level) {
    case "on_track":
      return "On track";
    case "at_risk":
      return "At risk (close to your daily cap)";
    case "impossible":
      return "Impossible with this daily cap";
  }
}

const WEEKDAYS = [
  { code: "MON", label: "Mon" },
  { code: "TUE", label: "Tue" },
  { code: "WED", label: "Wed" },
  { code: "THU", label: "Thu" },
  { code: "FRI", label: "Fri" },
  { code: "SAT", label: "Sat" },
  { code: "SUN", label: "Sun" },
] as const;

type WeekdayCode = (typeof WEEKDAYS)[number]["code"];

export default function GoalsPage() {
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const [title, setTitle] = useState("");
  const [totalUnits, setTotalUnits] = useState<string>("");
  const [unitName, setUnitName] = useState("lessons");
  const [startDate, setStartDate] = useState<string>(todayKey);
  const [deadline, setDeadline] = useState("");
  const [creating, setCreating] = useState(false);
  const [weightsRaw, setWeightsRaw] = useState("");
  const [availableDays, setAvailableDays] = useState<WeekdayCode[]>([]);
  const [maxUnitsPerDay, setMaxUnitsPerDay] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PlanItem[] | null>(null);
  const [previewPlanning, setPreviewPlanning] = useState<PreviewPlanning | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  type GoalTask = {
    id: string;
    title: string;
    dueDate: string | null;
    status: "todo" | "doing" | "done";
    unitStart?: number | null;
    unitEnd?: number | null;
  };

  type Goal = {
    id: string;
    title: string;
    totalUnits: number;
    unitName: string;
    deadline: string;
    availableDays?: WeekdayCode[];
    maxUnitsPerDay?: number | null;
    tasks: GoalTask[];
  };

  const [goalsLoading, setGoalsLoading] = useState(false);
  const [goalsList, setGoalsList] = useState<Goal[]>([]);
  const [expandedGoalIds, setExpandedGoalIds] = useState<Record<string, boolean>>({});
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [showPlansDropdown, setShowPlansDropdown] = useState(true);
  const [goalIdPendingDelete, setGoalIdPendingDelete] = useState<string | null>(null);

  const [rebalanceGoalId, setRebalanceGoalId] = useState<string | null>(null);
  const [rebalancePreview, setRebalancePreview] = useState<RebalancePreviewResponse | null>(null);
  const [rebalanceLoading, setRebalanceLoading] = useState(false);
  const [rebalanceConfirming, setRebalanceConfirming] = useState(false);
  const [rebalanceError, setRebalanceError] = useState<string | null>(null);
  const [selectedRebalanceStrategy, setSelectedRebalanceStrategy] = useState<
    RebalanceStrategy | ""
  >("");

  const [agentPreviewByGoal, setAgentPreviewByGoal] = useState<
    Record<string, AgentPreviewResponse | null>
  >({});
  const [agentPreviewLoading, setAgentPreviewLoading] = useState<Record<string, boolean>>({});
  const [agentPreviewError, setAgentPreviewError] = useState<Record<string, string | null>>({});
  const [agentApplyLoading, setAgentApplyLoading] = useState<Record<string, boolean>>({});
  const [agentApplySuccess, setAgentApplySuccess] = useState<Record<string, string | null>>({});
  const previewRefreshTimersRef = useRef<
    Record<string, ReturnType<typeof globalThis.setTimeout>>
  >({});

  const [editTitle, setEditTitle] = useState("");
  const [editTotalUnits, setEditTotalUnits] = useState<string>("");
  const [editUnitName, setEditUnitName] = useState<string>("");
  const [editDeadline, setEditDeadline] = useState<string>("");
  const [editAvailableDays, setEditAvailableDays] = useState<WeekdayCode[]>([]);
  const [editMaxUnitsPerDay, setEditMaxUnitsPerDay] = useState<string>("");

  const normalizeSelectedDays = (days: WeekdayCode[]) => (days.length === 0 ? [] : days);

  /** Positive integer or undefined (omit = unlimited). */
  function parseMaxUnitsPerDayForApi(raw: string): number | undefined {
    const t = raw.trim();
    if (!t) return undefined;
    const n = Number(t);
    if (!Number.isFinite(n) || n < 1) return undefined;
    return Math.floor(n);
  }
  const toggleDay = (
    current: WeekdayCode[],
    code: WeekdayCode,
    setter: (days: WeekdayCode[]) => void
  ) => {
    setter(current.includes(code) ? current.filter((d) => d !== code) : [...current, code]);
  };

  const toDateInput = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
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

  const loadAgentPreview = useCallback(async (goalId: string) => {
    setAgentPreviewLoading((prev) => ({ ...prev, [goalId]: true }));
    setAgentPreviewError((prev) => ({ ...prev, [goalId]: null }));
    setAgentApplySuccess((prev) => ({ ...prev, [goalId]: null }));
    try {
      const data = (await api(`/goals/${goalId}/agent-preview`)) as AgentPreviewResponse;
      setAgentPreviewByGoal((prev) => ({ ...prev, [goalId]: data }));
    } catch (e: unknown) {
      setAgentPreviewByGoal((prev) => ({ ...prev, [goalId]: null }));
      setAgentPreviewError((prev) => ({
        ...prev,
        [goalId]: e instanceof Error ? e.message : "Could not load agent preview",
      }));
    } finally {
      setAgentPreviewLoading((prev) => ({ ...prev, [goalId]: false }));
    }
  }, []);

  /**
   * Debounced auto-refresh: whenever schedule data changes, refresh agent preview
   * for expanded goals without requiring a manual "Refresh" click.
   */
  const scheduleAgentPreviewRefresh = useCallback(
    (goalIds: string[], delayMs = 250) => {
      const uniqueGoalIds = Array.from(new Set(goalIds)).filter(Boolean);
      for (const goalId of uniqueGoalIds) {
        const existingTimer = previewRefreshTimersRef.current[goalId];
        if (existingTimer) globalThis.clearTimeout(existingTimer);
        previewRefreshTimersRef.current[goalId] = globalThis.setTimeout(() => {
          if (expandedGoalIds[goalId]) {
            void loadAgentPreview(goalId);
          }
          delete previewRefreshTimersRef.current[goalId];
        }, delayMs);
      }
    },
    [expandedGoalIds, loadAgentPreview]
  );

  const applyAgentRebalance = useCallback(
    async (goalId: string) => {
      setAgentApplyLoading((prev) => ({ ...prev, [goalId]: true }));
      setAgentApplySuccess((prev) => ({ ...prev, [goalId]: null }));
      setAgentPreviewError((prev) => ({ ...prev, [goalId]: null }));
      try {
        await api(`/goals/${goalId}/apply-agent-rebalance`, {
          method: "POST",
          body: JSON.stringify({}),
        });
        setAgentApplySuccess((prev) => ({
          ...prev,
          [goalId]: "Rebalance applied. Tasks updated.",
        }));
        await loadGoals();
        emitAgentMutation({ type: "goal_rebalanced" });
        scheduleAgentPreviewRefresh([goalId], 0);
      } catch (e: unknown) {
        setAgentPreviewError((prev) => ({
          ...prev,
          [goalId]: e instanceof Error ? e.message : "Could not apply rebalance",
        }));
      } finally {
        setAgentApplyLoading((prev) => ({ ...prev, [goalId]: false }));
      }
    },
    [loadGoals, scheduleAgentPreviewRefresh]
  );

  useEffect(() => {
    loadGoals();
  }, [loadGoals]);

  useEffect(() => {
    return onAgentMutation(() => {
      loadGoals();
    });
  }, [loadGoals]);

  useEffect(() => {
    return () => {
      for (const timerId of Object.values(previewRefreshTimersRef.current)) {
        globalThis.clearTimeout(timerId);
      }
      previewRefreshTimersRef.current = {};
    };
  }, []);

  useEffect(() => {
    const id = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
    if (!id) return;
    const t = globalThis.setTimeout(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
    return () => globalThis.clearTimeout(t);
  }, []);

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
    setPreviewPlanning(null);

    setCreating(true);
    try {
      const weights = parseWeights();
      const dailyCap = parseMaxUnitsPerDayForApi(maxUnitsPerDay);

      // 1) Create the goal
      const goal = await api("/goals", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          totalUnits: Number(totalUnits),
          unitName: unitName.trim(),
          deadline,
          availableDays: normalizeSelectedDays(availableDays),
          ...(dailyCap !== undefined ? { maxUnitsPerDay: dailyCap } : {}),
        }),
      });

      // 2) Ask backend to build a day‑by‑day plan
      const previewData = await api(`/goals/${goal.id}/plan/preview`, {
        method: "POST",
        body: JSON.stringify({
          weights,
          startDate,
          availableDays: normalizeSelectedDays(availableDays),
          ...(dailyCap !== undefined ? { maxUnitsPerDay: dailyCap } : {}),
        }),
      });

      const items: PlanItem[] = previewData.items ?? [];
      setPreview(items);

      const planning = previewData.planning as
        | (PreviewPlanning & { startDate?: string })
        | undefined;
      if (
        planning &&
        typeof planning.riskLevel === "string" &&
        typeof planning.requiredUnitsPerDay === "number" &&
        typeof planning.eligibleDays === "number"
      ) {
        setPreviewPlanning({
          riskLevel: planning.riskLevel,
          requiredUnitsPerDay: planning.requiredUnitsPerDay,
          eligibleDays: planning.eligibleDays,
        });
      } else {
        setPreviewPlanning(null);
      }

      if (planning?.riskLevel === "impossible") {
        setError(
          "This goal does not fit your daily unit cap. Add eligible days, raise the cap, or reduce total units."
        );
        return;
      }

      if (items.length === 0) {
        setError("Could not generate a plan for this goal.");
        return;
      }

      // 3) Confirm the plan: this creates actual tasks tied to the goal
      await api(`/goals/${goal.id}/plan/confirm`, {
        method: "POST",
        body: JSON.stringify({
          items,
          availableDays: normalizeSelectedDays(availableDays),
          ...(dailyCap !== undefined ? { maxUnitsPerDay: dailyCap } : {}),
        }),
      });

      setSuccessMsg(
        `Plan created: ${items.length} days of ${unitName} added as tasks.`
      );
      await loadGoals();
      scheduleAgentPreviewRefresh([goal.id]);
      // Optionally clear inputs for the next goal
      setTitle("");
      setTotalUnits("");
      setDeadline("");
      setAvailableDays([]);
      setMaxUnitsPerDay("");

      const wasAtRisk = planning?.riskLevel === "at_risk";
      setPreview(null);
      if (
        wasAtRisk &&
        planning &&
        typeof planning.requiredUnitsPerDay === "number" &&
        typeof planning.eligibleDays === "number"
      ) {
        setPreviewPlanning({
          riskLevel: "at_risk",
          requiredUnitsPerDay: planning.requiredUnitsPerDay,
          eligibleDays: planning.eligibleDays,
        });
      } else {
        setPreviewPlanning(null);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create goal");
    } finally {
      setCreating(false);
    }
  }

  const toggleGoalTaskStatus = async (
    goalId: string,
    taskId: string,
    current: GoalTask["status"]
  ) => {
    const next = current === "done" ? "todo" : "done";
    await api(`/tasks/${taskId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: next }),
    });
    await loadGoals();
    scheduleAgentPreviewRefresh([goalId]);
  };

  const deleteGoal = async (goalId: string) => {
    await api(`/goals/${goalId}`, {
      method: "DELETE",
    });
    await loadGoals();
  };

  const closeRebalance = useCallback(() => {
    setRebalanceGoalId(null);
    setRebalancePreview(null);
    setRebalanceError(null);
    setSelectedRebalanceStrategy("");
  }, []);

  useEffect(() => {
    if (!rebalanceGoalId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRebalance();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rebalanceGoalId, closeRebalance]);

  const openRebalance = async (goalId: string) => {
    setRebalanceGoalId(goalId);
    setRebalancePreview(null);
    setRebalanceError(null);
    setSelectedRebalanceStrategy("");
    setRebalanceLoading(true);
    try {
      const data = (await api(`/goals/${goalId}/plan/rebalance-preview`, {
        method: "POST",
      })) as RebalancePreviewResponse;
      setRebalancePreview(data);
      const first = data.options?.find((o) => o.feasible);
      if (first) setSelectedRebalanceStrategy(first.strategy);
    } catch (e: unknown) {
      setRebalanceError(e instanceof Error ? e.message : "Failed to load rebalance options");
    } finally {
      setRebalanceLoading(false);
    }
  };

  const confirmRebalance = async () => {
    if (!rebalanceGoalId || !selectedRebalanceStrategy) return;
    setRebalanceConfirming(true);
    setRebalanceError(null);
    try {
      await api(`/goals/${rebalanceGoalId}/plan/rebalance-confirm`, {
        method: "POST",
        body: JSON.stringify({ strategy: selectedRebalanceStrategy }),
      });
      closeRebalance();
      await loadGoals();
      emitAgentMutation({ type: "goal_rebalanced" });
      scheduleAgentPreviewRefresh([rebalanceGoalId]);
    } catch (e: unknown) {
      setRebalanceError(e instanceof Error ? e.message : "Could not apply rebalance");
    } finally {
      setRebalanceConfirming(false);
    }
  };

  const startDateFromGoal = (goal: Goal) => {
    const dueDates = goal.tasks
      .map((t) => t.dueDate)
      .filter(Boolean) as string[];
    if (dueDates.length === 0) return todayKey;
    const min = new Date(Math.min(...dueDates.map((d) => new Date(d).getTime())));
    return min.toISOString().slice(0, 10);
  };

  const startReplanFromEdit = async (goalId: string) => {
    const goal = goalsList.find((g) => g.id === goalId);
    if (!goal) return;

    const editCap = parseMaxUnitsPerDayForApi(editMaxUnitsPerDay);

    setError(null);
    try {
      await api(`/goals/${goalId}`, {
        method: "PUT",
        body: JSON.stringify({
          title: editTitle.trim(),
          totalUnits: Number(editTotalUnits),
          unitName: editUnitName.trim(),
          deadline: editDeadline,
          availableDays: normalizeSelectedDays(editAvailableDays),
          maxUnitsPerDay: editCap !== undefined ? editCap : null,
        }),
      });

      await api(`/goals/${goalId}/tasks`, {
        method: "DELETE",
      });

      const startDateIso = startDateFromGoal(goal);
      const previewBody: Record<string, unknown> = {
        weights: null,
        startDate: startDateIso,
        availableDays: normalizeSelectedDays(editAvailableDays),
      };
      if (editCap !== undefined) {
        previewBody.maxUnitsPerDay = editCap;
      }

      const previewData = await api(`/goals/${goalId}/plan/preview`, {
        method: "POST",
        body: JSON.stringify(previewBody),
      });

      const items: PlanItem[] = previewData.items ?? [];
      const planning = previewData.planning as { riskLevel?: string } | undefined;
      if (planning?.riskLevel === "impossible" || !items.length) {
        setError(
          planning?.riskLevel === "impossible"
            ? "Re-plan does not fit your daily unit cap. Adjust settings and try again."
            : "Could not generate a plan after edit."
        );
        return;
      }

      await api(`/goals/${goalId}/plan/confirm`, {
        method: "POST",
        body: JSON.stringify({
          items,
          availableDays: normalizeSelectedDays(editAvailableDays),
          ...(editCap !== undefined ? { maxUnitsPerDay: editCap } : {}),
        }),
      });

      setEditingGoalId(null);
      await loadGoals();
      scheduleAgentPreviewRefresh([goalId]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save & re-plan failed");
    }
  };

  return (
    <div className="ff-page flex flex-col">
      <main className="w-full max-w-6xl mx-auto px-4 sm:px-6 pt-6 sm:pt-10 pb-20 space-y-8 sm:space-y-10">
        {/* HERO */}
        <section className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-8 md:p-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 shadow-sm">
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
            className="ff-illustration w-full max-w-[260px] sm:max-w-[340px] self-center md:self-auto md:-translate-x-16"
          />
        </section>

        {/* Goal planner form */}
        <section
          id="goal-planner"
          className="rounded-2xl border border-gray-200 bg-white shadow-sm px-6 py-8 md:px-10 md:py-9 space-y-8"
        >
          <header className="space-y-2">
            <h2 className="text-xl font-semibold tracking-tight text-gray-900">
              Set goals, build discipline
            </h2>
            <p className="text-sm text-gray-600 max-w-2xl leading-relaxed">
              Turn a big goal into scheduled work you can actually follow.
            </p>
          </header>

          <form onSubmit={handleCreateGoal} className="space-y-8">
            <div className="rounded-xl border border-gray-100 bg-[#FAFAFA]/90 p-5 md:p-6 space-y-4">
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-[0.14em]">
                Goal details
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-800">
                    Goal name{" "}
                    <span className="text-gray-400 font-normal" aria-hidden>
                      *
                    </span>
                  </label>
                  <input
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900/15"
                    placeholder="Finish 30‑day JavaScript course"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-800 flex items-center justify-between gap-2">
                    <span>
                      Total units{" "}
                      <span className="text-gray-400 font-normal" aria-hidden>
                        *
                      </span>
                    </span>
                    <span className="text-[11px] font-normal text-gray-400 shrink-0">
                      e.g. 30 lessons
                    </span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900/15"
                    value={totalUnits}
                    onChange={(e) => setTotalUnits(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-800">
                    Unit name{" "}
                    <span className="text-gray-400 font-normal" aria-hidden>
                      *
                    </span>
                  </label>
                  <input
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900/15"
                    placeholder="lessons, chapters, sessions…"
                    value={unitName}
                    onChange={(e) => setUnitName(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-800">
                    Start date{" "}
                    <span className="text-gray-400 font-normal" aria-hidden>
                      *
                    </span>
                  </label>
                  <input
                    type="date"
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900/15"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5 md:col-span-2 md:max-w-md">
                  <label className="text-sm font-medium text-gray-800">
                    Target finish date{" "}
                    <span className="text-gray-400 font-normal" aria-hidden>
                      *
                    </span>
                  </label>
                  <input
                    type="date"
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900/15"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-gray-100 bg-[#FAFAFA]/90 p-5 md:p-6 space-y-4">
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-[0.14em]">
                Schedule preferences
              </p>
              <div className="grid grid-cols-1 gap-y-5">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-800">
                    Available study days
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {WEEKDAYS.map((d) => {
                      const selected = availableDays.includes(d.code);
                      return (
                        <button
                          key={d.code}
                          type="button"
                          onClick={() => toggleDay(availableDays, d.code, setAvailableDays)}
                          className={`rounded-full border px-3.5 py-2 text-xs font-semibold ${
                            selected
                              ? "border-gray-900 bg-gray-900 text-white shadow-sm"
                              : "border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:bg-gray-50 hover:text-gray-700"
                          }`}
                        >
                          {d.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-gray-400 leading-relaxed pt-0.5">
                    Leave all unselected to plan across all days.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-800 flex items-center justify-between gap-2">
                    <span>Optional: unit sizes</span>
                    <span className="text-[11px] font-normal text-gray-400 shrink-0">
                      short, long, or 1,2,3…
                    </span>
                  </label>
                  <input
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900/15"
                    placeholder="Example for 4 chapters: short, long, medium, medium"
                    value={weightsRaw}
                    onChange={(e) => setWeightsRaw(e.target.value)}
                  />
                  <p className="text-[11px] text-gray-400 leading-relaxed">
                    If you leave this empty, FocusFlow spreads units evenly. If you fill it,
                    earlier entries map to earlier units (chapter 1, chapter 2, …).
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-gray-100 bg-[#FAFAFA]/90 p-5 md:p-6 space-y-4">
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-[0.14em]">
                Workload limits
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
                <div className="space-y-1.5 md:max-w-md">
                  <label className="text-sm font-medium text-gray-800 flex items-center justify-between gap-2">
                    <span>Max units per day</span>
                    <span className="text-[11px] font-normal text-gray-400">Optional</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    placeholder="Unlimited"
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900/15"
                    value={maxUnitsPerDay}
                    onChange={(e) => setMaxUnitsPerDay(e.target.value)}
                  />
                  <p className="text-[11px] text-gray-400 leading-relaxed">
                    Leave empty for no daily cap. Scheduled days will have at most this many
                    units.
                  </p>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-gray-100 space-y-4">
              {(error || successMsg) && (
                <div className="space-y-1">
                  {error && <p className="text-sm text-red-600">{error}</p>}
                  {successMsg && <p className="text-sm text-emerald-600">{successMsg}</p>}
                </div>
              )}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[11px] text-gray-400 leading-relaxed max-w-md order-2 sm:order-1">
                  You can rebalance this later with Agent Insight.
                </p>
                <button
                  type="submit"
                  disabled={!canSubmit || creating}
                  className="order-1 sm:order-2 shrink-0 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-900 shadow-sm transition hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {creating ? "Planning…" : "Create goal & tasks"}
                </button>
              </div>
            </div>
          </form>

          {previewPlanning && (
            <div
              className={`mt-4 rounded-lg border p-4 text-sm space-y-2 ${
                previewPlanning.riskLevel === "impossible"
                  ? "bg-red-50 border-red-200 text-red-950"
                  : previewPlanning.riskLevel === "at_risk"
                    ? "bg-amber-50 border-amber-200 text-amber-950"
                    : "bg-gray-50 border-gray-200 text-gray-800"
              }`}
            >
              <p>
                <span className="font-medium">Deadline risk: </span>
                {riskLevelLabel(previewPlanning.riskLevel)}
                <span className="opacity-90">
                  {" "}
                  — {previewPlanning.requiredUnitsPerDay.toFixed(2)} units/day needed across{" "}
                  {previewPlanning.eligibleDays} eligible day(s)
                </span>
              </p>
              {preview && preview.length > 0 && (
                <>
                  <p className="font-medium pt-1">First few planned days</p>
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
                </>
              )}
              {previewPlanning.riskLevel === "at_risk" &&
                !(preview && preview.length > 0) && (
                  <p className="text-xs mt-1 leading-relaxed opacity-90">
                    Your plan is saved. Average daily load is close to your cap — consider more
                    eligible days or a higher daily limit if you want buffer.
                  </p>
                )}
              {previewPlanning.riskLevel === "at_risk" && !creating && (
                <button
                  type="button"
                  onClick={() => {
                    setPreviewPlanning(null);
                    setPreview(null);
                  }}
                  className="mt-3 text-xs font-medium text-amber-900/80 underline underline-offset-2 hover:text-amber-950"
                >
                  Dismiss warning
                </button>
              )}
            </div>
          )}
        </section>

        {/* Saved plans */}
        <section id="saved-plans" className="space-y-3">
          <button
            type="button"
            onClick={() => setShowPlansDropdown((v) => !v)}
            className="flex w-full items-center justify-between rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm"
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
                <div className="space-y-5">
                  {goalsList.map((g) => {
                const isExpanded = expandedGoalIds[g.id] === true;
                const tasksSorted = [...(g.tasks || [])].sort((a, b) => {
                  const ad = a.dueDate ? new Date(a.dueDate).getTime() : 0;
                  const bd = b.dueDate ? new Date(b.dueDate).getTime() : 0;
                  return ad - bd;
                });
                const activeCount = tasksSorted.filter((t) => t.status !== "done").length;
                const completedUnits = sumCompletedUnits(tasksSorted);
                const progressPct =
                  g.totalUnits > 0
                    ? Math.min(100, Math.round((completedUnits / g.totalUnits) * 100))
                    : 0;
                return (
                  <div
                    key={g.id}
                    className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-4"
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                      <div className="min-w-0 flex-1 space-y-3">
                        <h3 className="text-xl font-bold text-gray-900 leading-snug truncate">
                          {g.title}
                        </h3>
                        <div className="flex items-center gap-3">
                          <div
                            className="h-2 flex-1 min-w-0 rounded-full bg-gray-200/90 overflow-hidden"
                            role="progressbar"
                            aria-valuenow={progressPct}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label="Goal progress"
                          >
                            <div
                              className="h-full rounded-full bg-[#8FABD4]"
                              style={{ width: `${progressPct}%` }}
                            />
                          </div>
                          <span className="text-sm font-medium tabular-nums text-gray-600 shrink-0">
                            {progressPct}%
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                          <span>
                            {completedUnits} / {g.totalUnits} {g.unitName}
                          </span>
                          <span>Deadline {toDateInput(g.deadline)}</span>
                          <span>
                            {activeCount} active {activeCount === 1 ? "step" : "steps"}
                          </span>
                          {g.maxUnitsPerDay != null && g.maxUnitsPerDay > 0 ? (
                            <span>Max {g.maxUnitsPerDay}/day</span>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0 sm:pt-0.5">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedGoalIds((prev) => {
                              const willExpand = !prev[g.id];
                              if (willExpand) void loadAgentPreview(g.id);
                              return { ...prev, [g.id]: willExpand };
                            })
                          }
                          className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
                        >
                          <ChevronDown
                            size={16}
                            className={isExpanded ? "rotate-180" : ""}
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
                                setEditAvailableDays(
                                  Array.isArray(g.availableDays) ? g.availableDays : []
                                );
                                setEditMaxUnitsPerDay(
                                  g.maxUnitsPerDay != null && g.maxUnitsPerDay > 0
                                    ? String(g.maxUnitsPerDay)
                                    : ""
                                );
                              }
                              return next;
                            })
                          }
                          className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
                          aria-label="Edit goal"
                        >
                          <Pencil size={16} />
                        </button>

                        <button
                          type="button"
                          onClick={() => openRebalance(g.id)}
                          className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
                          aria-label="Rebalance or recover plan"
                          title="Rebalance or recover plan"
                        >
                          <RefreshCw size={16} />
                        </button>

                        <button
                          type="button"
                          onClick={() => setGoalIdPendingDelete(g.id)}
                          className="inline-flex items-center rounded-full border border-red-200 bg-white px-3 py-1.5 text-sm hover:bg-red-50"
                          aria-label="Delete goal"
                        >
                          <Trash2 size={16} className="text-red-600" />
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="space-y-4 pt-1 border-t border-gray-200/80">
                        <div className="rounded-lg border border-gray-200 bg-gray-100/90 p-4 space-y-3 dark:border-[#2a303a] dark:bg-[#1c2028]">
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="text-sm font-semibold text-gray-900 dark:text-[#f5f7fb]">Agent Insight</h3>
                            <button
                              type="button"
                              onClick={() => void loadAgentPreview(g.id)}
                              disabled={agentPreviewLoading[g.id]}
                              className="text-xs font-medium text-gray-600 hover:text-black underline underline-offset-2 disabled:opacity-50 dark:text-[#cfd6e2] dark:hover:text-[#f5f7fb]"
                            >
                              {agentPreviewLoading[g.id] ? "Refreshing…" : "Refresh"}
                            </button>
                          </div>

                          {agentPreviewLoading[g.id] && !agentPreviewByGoal[g.id] && (
                            <p className="text-xs text-gray-500 dark:text-[#cfd6e2]">Loading agent preview…</p>
                          )}
                          {agentPreviewError[g.id] && (
                            <p className="text-xs text-red-600">{agentPreviewError[g.id]}</p>
                          )}
                          {agentApplySuccess[g.id] && (
                            <p className="text-xs text-emerald-700">{agentApplySuccess[g.id]}</p>
                          )}

                          {agentPreviewByGoal[g.id] && (
                            <>
                              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs">
                                <div>
                                  <dt className="text-gray-500 dark:text-[#cfd6e2]">Status</dt>
                                  <dd
                                    className={`font-semibold text-sm ${statusToneClass(
                                      agentPreviewByGoal[g.id]?.evaluation?.status
                                    )}`}
                                  >
                                    {formatAgentStatus(agentPreviewByGoal[g.id]?.evaluation?.status)}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="text-gray-500 dark:text-[#cfd6e2]">Completion</dt>
                                  <dd className="font-medium text-gray-900 dark:text-[#f5f7fb]">
                                    {typeof agentPreviewByGoal[g.id]?.evaluation?.completionRate ===
                                    "number"
                                      ? `${(
                                          (agentPreviewByGoal[g.id]?.evaluation?.completionRate as number) *
                                          100
                                        ).toFixed(1)}%`
                                      : "—"}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="text-gray-500 dark:text-[#cfd6e2]">
                                    {agentPreviewByGoal[g.id]?.failureAnalysis?.primaryFailureMode ===
                                    "no_failure_detected"
                                      ? "System Status"
                                      : "Primary issue"}
                                  </dt>
                                  <dd className="font-medium text-gray-900 dark:text-[#f5f7fb]">
                                    {agentPreviewByGoal[g.id]?.failureAnalysis?.primaryFailureMode ===
                                    "no_failure_detected"
                                      ? "No issues detected"
                                      : formatAgentFailureMode(
                                          agentPreviewByGoal[g.id]?.failureAnalysis?.primaryFailureMode
                                        )}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="text-gray-500 dark:text-[#cfd6e2]">Severity</dt>
                                  <dd className="font-medium text-gray-900 dark:text-[#f5f7fb]">
                                    {formatAgentSeverity(
                                      agentPreviewByGoal[g.id]?.failureAnalysis?.severity
                                    )}
                                  </dd>
                                </div>
                              </dl>
                              <p className="text-xs text-gray-800 leading-relaxed dark:text-[#cfd6e2]">
                                <span className="font-medium text-gray-700 dark:text-[#f5f7fb]">Recommendation: </span>
                                <span className="font-semibold text-gray-950 dark:text-[#f5f7fb]">
                                  {recommendationFromStatus(
                                    agentPreviewByGoal[g.id]?.evaluation?.status
                                  )}
                                </span>
                              </p>
                              {Array.isArray(
                                agentPreviewByGoal[g.id]?.rebalanceRecommendation?.warnings
                              ) &&
                                (agentPreviewByGoal[g.id]!.rebalanceRecommendation.warnings!.length >
                                  0 && (
                                  <div className="text-xs">
                                    <p className="font-medium text-amber-900 mb-1">Warnings</p>
                                    <ul className="list-disc pl-4 space-y-0.5 text-amber-900/90">
                                      {agentPreviewByGoal[g.id]!.rebalanceRecommendation.warnings!.map(
                                        (w, i) => (
                                          <li key={i}>{w}</li>
                                        )
                                      )}
                                    </ul>
                                  </div>
                                ))}

                              {agentPreviewByGoal[g.id]?.rebalanceRecommendation?.canRebalance ? (
                                <button
                                  type="button"
                                  disabled={!!agentApplyLoading[g.id]}
                                  onClick={() => void applyAgentRebalance(g.id)}
                                  className="rounded-lg bg-black px-4 py-2 text-xs font-medium text-white hover:bg-black/90 disabled:opacity-50 dark:bg-white dark:text-[#0b0c0f] dark:hover:bg-white/90"
                                >
                                  {agentApplyLoading[g.id] ? "Applying…" : "Apply Rebalance"}
                                </button>
                              ) : (
                                <div className="text-xs text-gray-600 space-y-1 rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-[#2a303a] dark:bg-[#171a20] dark:text-[#cfd6e2]">
                                  <p>
                                    <span className="font-medium text-gray-800 dark:text-[#f5f7fb]">Next Action: </span>
                                    <span>{formatNextAction(agentPreviewByGoal[g.id]?.nextAction)}</span>
                                  </p>
                                  {agentPreviewByGoal[g.id]?.rebalanceRecommendation?.reason && (
                                    <p className="text-gray-700 dark:text-[#cfd6e2]">
                                      <span className="font-medium text-gray-800 dark:text-[#f5f7fb]">Reason: </span>
                                      {agentPreviewByGoal[g.id]!.rebalanceRecommendation.reason}
                                    </p>
                                  )}
                                  <p className="text-gray-500 dark:text-[#cfd6e2]">
                                    Based on your current pace and workload, your schedule is achievable.
                                  </p>
                                </div>
                              )}
                            </>
                          )}
                        </div>

                        <ul className="space-y-2">
                          {tasksSorted.length === 0 ? (
                            <li className="text-sm text-gray-500">No tasks in this plan.</li>
                          ) : (
                            tasksSorted.map((t) => {
                              const dueKey = t.dueDate
                                ? taskDueCalendarDayKey(t.dueDate)
                                : null;
                              const isOverdue =
                                t.status !== "done" &&
                                dueKey != null &&
                                dueKey < todayKey;
                              const statusLabel =
                                t.status === "done"
                                  ? "done"
                                  : isOverdue
                                    ? "overdue"
                                    : t.status;

                              return (
                              <li
                                key={t.id}
                                className={`flex items-center justify-between gap-3 rounded-lg border border-gray-200/90 px-3 py-2 ${
                                  t.status === "done" ? "bg-white/80" : "bg-white"
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() => toggleGoalTaskStatus(g.id, t.id, t.status)}
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
                                      : isOverdue
                                        ? "bg-red-100 text-red-700"
                                        : "bg-gray-200 text-gray-700"
                                  }`}
                                >
                                  {statusLabel}
                                </span>
                              </li>
                            );
                            })
                          )}
                        </ul>
                      </div>
                    )}

                    {editingGoalId === g.id && (
                      <div className="border border-gray-200 rounded-lg p-4 bg-white space-y-3">
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
                          <div className="space-y-1 md:col-span-2">
                            <label className="text-xs text-gray-500">Available study days</label>
                            <div className="flex flex-wrap gap-2">
                              {WEEKDAYS.map((d) => {
                                const selected = editAvailableDays.includes(d.code);
                                return (
                                  <button
                                    key={d.code}
                                    type="button"
                                    onClick={() =>
                                      toggleDay(editAvailableDays, d.code, setEditAvailableDays)
                                    }
                                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                                      selected
                                        ? "border-black bg-black text-white"
                                        : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                                    }`}
                                  >
                                    {d.label}
                                  </button>
                                );
                              })}
                            </div>
                            <p className="text-xs text-gray-500">
                              Leave all unselected to plan across all days.
                            </p>
                          </div>
                          <div className="space-y-1 md:col-span-2">
                            <label className="text-xs text-gray-500">Max units per day (optional)</label>
                            <input
                              type="number"
                              min={1}
                              placeholder="Unlimited"
                              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none"
                              value={editMaxUnitsPerDay}
                              onChange={(e) => setEditMaxUnitsPerDay(e.target.value)}
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

      {rebalanceGoalId && (
        <div
          className="fixed inset-0 z-[90] flex items-start justify-center pt-10 sm:pt-14 px-4"
          role="presentation"
          onClick={closeRebalance}
        >
          <div className="absolute inset-0 bg-black/40 backdrop-blur-md" aria-hidden />
          <div
            className="relative w-full max-w-lg max-h-[85vh] cursor-default overflow-y-auto bg-white rounded-2xl shadow-2xl border border-gray-200"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="rebalance-title"
          >
            <div className="flex items-start justify-between gap-3 px-6 pt-6 pb-4 border-b border-gray-100">
              <h2 id="rebalance-title" className="text-lg font-semibold tracking-tight">
                Rebalance plan
              </h2>
              <button
                type="button"
                onClick={closeRebalance}
                className="rounded-full p-2 hover:bg-gray-100 text-gray-500 hover:text-black"
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4 text-sm">
              {rebalanceLoading && <p className="text-gray-500">Loading recovery options…</p>}
              {rebalanceError && <p className="text-red-600">{rebalanceError}</p>}
              {rebalancePreview && !rebalanceLoading && (
                <>
                  <div className="text-gray-700 space-y-1">
                    <p>
                      <span className="font-medium">Completed:</span>{" "}
                      {rebalancePreview.completedUnits} units
                    </p>
                    <p>
                      <span className="font-medium">Expected by today:</span>{" "}
                      {rebalancePreview.expectedUnitsByToday} units
                    </p>
                    <p>
                      <span className="font-medium">Remaining:</span>{" "}
                      {rebalancePreview.remainingUnits} units
                    </p>
                    <p
                      className={
                        rebalancePreview.isBehind
                          ? "text-amber-900 font-medium pt-1"
                          : "text-emerald-800 font-medium pt-1"
                      }
                    >
                      {rebalancePreview.isBehind
                        ? "You are behind the original schedule."
                        : "You are on track relative to your original schedule."}
                    </p>
                  </div>
                  {rebalancePreview.isBehind ? (
                    <div className="space-y-3">
                      <p className="font-medium text-gray-900">Choose a recovery approach</p>
                      <ul className="space-y-2">
                        {rebalancePreview.options.map((opt) => (
                          <li key={opt.strategy}>
                            <label
                              className={`flex gap-3 rounded-xl border p-3 ${
                                opt.feasible
                                  ? "cursor-pointer hover:bg-gray-50 border-gray-200"
                                  : "opacity-55 border-gray-100 cursor-not-allowed"
                              }`}
                            >
                              <input
                                type="radio"
                                name="rebalance-strategy"
                                disabled={!opt.feasible}
                                checked={selectedRebalanceStrategy === opt.strategy}
                                onChange={() => setSelectedRebalanceStrategy(opt.strategy)}
                                className="mt-1 shrink-0"
                              />
                              <div className="min-w-0">
                                <div className="font-medium text-gray-900">{opt.label}</div>
                                {!opt.feasible && (
                                  <div className="text-[11px] font-semibold uppercase text-gray-400 mt-0.5">
                                    Not available
                                  </div>
                                )}
                                <div className="text-gray-600 text-xs mt-1 leading-relaxed">
                                  {opt.description}
                                </div>
                                <div className="text-xs text-gray-500 mt-1">
                                  Est. load: ~{opt.estimatedDailyLoad} units/day
                                  {opt.newDeadline && (
                                    <>
                                      {" "}
                                      • New deadline:{" "}
                                      {new Date(opt.newDeadline).toLocaleDateString()}
                                    </>
                                  )}
                                  {opt.suggestedMaxUnitsPerDay != null && (
                                    <>
                                      {" "}
                                      • Suggested cap: {opt.suggestedMaxUnitsPerDay}/day
                                    </>
                                  )}
                                </div>
                              </div>
                            </label>
                          </li>
                        ))}
                      </ul>
                      <div className="flex flex-wrap justify-end gap-2 pt-2">
                        <button
                          type="button"
                          onClick={closeRebalance}
                          className="rounded-lg border border-gray-200 px-4 py-2 text-sm hover:bg-gray-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={
                            !selectedRebalanceStrategy || rebalanceConfirming
                          }
                          onClick={() => void confirmRebalance()}
                          className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/90 disabled:opacity-50"
                        >
                          {rebalanceConfirming ? "Applying…" : "Apply selected"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-end pt-2">
                      <button
                        type="button"
                        onClick={closeRebalance}
                        className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/90"
                      >
                        Close
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={goalIdPendingDelete !== null}
        title="Are you sure?"
        message="This removes the goal and its planned tasks. You can't undo this."
        confirmLabel="Delete goal"
        onCancel={() => setGoalIdPendingDelete(null)}
        onConfirm={() => {
          const id = goalIdPendingDelete;
          setGoalIdPendingDelete(null);
          if (id) void deleteGoal(id);
        }}
      />
    </div>
  );
}
