"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  Sparkles,
  Clock,
  TrendingUp,
  ClipboardCheck,
  TrendingDown,
  Minus,
  ListChecks,
  ListTodo,
  Flame,
  Gauge,
  Lightbulb,
} from "lucide-react";
import {
  type AnalyticsInterval,
  compareProductivityScores,
  describeScoreChangeVsPrevious,
  tasksCompletionRate,
  PILLAR_LABELS,
} from "@/lib/productivityScore";
import type { AnalyticsSlice } from "@/lib/analyticsTypes";
import {
  fetchActivityPatterns,
  fetchAnalyticsDashboard,
  type ActivityPatternsDto,
} from "@/lib/analyticsApi";
import { dashboardDtoToAnalyticsSlice } from "@/lib/analyticsPresentation";
import {
  ProductivityTrendChart,
  TaskLoadVsCompletedChart,
} from "@/components/analytics";
import {
  deriveInsightsFromActivityPatterns,
  deriveRecommendationsFromActivityPatterns,
} from "@/lib/activityPatternsInsights";

export type { AnalyticsInterval };

function Card({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-2xl border border-gray-200 bg-white shadow-sm ${className}`}>
      {children}
    </div>
  );
}

function formatMins(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `${m} minutes`;
  if (m === 0) return `${h} hour${h === 1 ? "" : "s"}`;
  return `${h}h ${m}m`;
}

function formatPercent(rate: number) {
  return `${Math.round(rate * 100)}%`;
}

function ScoreChangeBadge({
  scoreDelta,
  compareLabel,
}: {
  scoreDelta: number;
  compareLabel: string;
}) {
  const { headline, detail } = describeScoreChangeVsPrevious(
    scoreDelta,
    compareLabel
  );
  const up = scoreDelta > 0;
  const flat = scoreDelta === 0;
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown;
  const tone = flat
    ? "bg-gray-100 text-gray-700 border-gray-200"
    : up
      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
      : "bg-amber-50 text-amber-900 border-amber-200";

  return (
    <div
      className={`inline-flex rounded-2xl border px-4 py-3 ${tone}`}
      role="status"
    >
      <div className="flex items-start gap-2">
        <Icon size={18} className="shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold">{headline}</p>
          <p className="text-xs opacity-90 mt-0.5">{detail}</p>
        </div>
      </div>
    </div>
  );
}

function IntervalSelector({
  value,
  onChange,
}: {
  value: AnalyticsInterval;
  onChange: (v: AnalyticsInterval) => void;
}) {
  const options: { id: AnalyticsInterval; label: string }[] = [
    { id: "day", label: "Day" },
    { id: "week", label: "Week" },
    { id: "month", label: "Month" },
  ];
  return (
    <div
      className="inline-flex rounded-full border border-gray-200 bg-[#F9F9F9] p-1"
      role="tablist"
      aria-label="Analytics interval"
    >
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          role="tab"
          aria-selected={value === opt.id}
          onClick={() => onChange(opt.id)}
          className={`rounded-full px-4 py-2 text-sm font-medium transition ${
            value === opt.id
              ? "bg-white text-gray-900 shadow-sm border border-gray-200"
              : "text-gray-600 hover:text-gray-900"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#F9F9F9] border border-gray-200 flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-gray-500">{label}</p>
          <p className="text-lg font-semibold text-gray-900 mt-1">{value}</p>
          <p className="text-xs text-gray-500 mt-2">{hint}</p>
        </div>
      </div>
    </Card>
  );
}

function ProductivityScoreCard({
  interval,
  comparison,
  compareLabel,
}: {
  interval: AnalyticsInterval;
  comparison: ReturnType<typeof compareProductivityScores>;
  compareLabel: string;
}) {
  const { currentBreakdown, scoreDelta } = comparison;
  const { score, pillars } = currentBreakdown;
  const change = describeScoreChangeVsPrevious(scoreDelta, compareLabel);

  const pillarRows: { key: keyof typeof pillars; label: string; value: number }[] =
    [
      { key: "tasks", label: PILLAR_LABELS.tasks, value: pillars.tasks },
      { key: "focus", label: PILLAR_LABELS.focus, value: pillars.focus },
      {
        key: "completion",
        label: PILLAR_LABELS.completion,
        value: pillars.completion,
      },
    ];

  const rangeLabel =
    interval === "day"
      ? "today"
      : interval === "week"
        ? "this week"
        : "this month";

  return (
    <Card className="p-6 border-gray-200 bg-[#F9F9F9]">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-white border border-gray-200 flex items-center justify-center shrink-0">
            <Gauge size={22} className="text-gray-800" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">
              Productivity score
            </p>
            <p className="text-xs text-gray-600 mt-1 max-w-md">
              Blends tasks you finished, focus time, and how much of your plan
              you completed ({rangeLabel}). Higher means you moved more real
              work forward.
            </p>
          </div>
        </div>
        <div className="text-left sm:text-right shrink-0">
          <p
            className="text-4xl font-semibold tracking-tight text-gray-900 tabular-nums"
            aria-label={`Productivity score ${score} out of 100`}
          >
            {score}
          </p>
          <p className="text-xs text-gray-500 mt-1">out of 100</p>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-gray-200 bg-white px-4 py-3">
        <p className="text-sm font-medium text-gray-900">{change.headline}</p>
        <p className="text-xs text-gray-600 mt-1">{change.detail}</p>
      </div>

      <div className="mt-5 space-y-3">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
          What’s driving this
        </p>
        {pillarRows.map((row) => (
          <div key={row.key}>
            <div className="flex justify-between text-xs text-gray-600 mb-1">
              <span>{row.label}</span>
              <span className="tabular-nums text-gray-900">{row.value}%</span>
            </div>
            <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-[#8FABD4]/80 transition-[width] duration-300"
                style={{ width: `${row.value}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function DominantHeroCard({
  data,
  comparison,
}: {
  data: AnalyticsSlice;
  comparison: ReturnType<typeof compareProductivityScores>;
}) {
  return (
    <Card className="p-8 bg-[#F9F9F9] border-gray-200">
      <div className="space-y-4 max-w-3xl">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-sm font-semibold text-gray-900">
            {data.heroTitle}
          </p>
          <ScoreChangeBadge
            scoreDelta={comparison.scoreDelta}
            compareLabel={data.compareLabel}
          />
        </div>

        <p className="text-2xl font-semibold text-gray-900">
          Productivity score:{" "}
          <span className="tabular-nums">{comparison.currentScore}</span>
          <span className="text-base font-normal text-gray-500"> / 100</span>
        </p>

        <p className="text-sm text-gray-600">{data.insight}</p>
      </div>
    </Card>
  );
}

function AssistantInsightsCard({
  headline,
  bullets,
}: {
  headline: string;
  bullets: string[];
}) {
  return (
    <Card className="overflow-hidden border-gray-200/90">
      <div className="px-5 py-4 border-b border-gray-100/90 bg-gradient-to-br from-[#F8F9FB] to-white flex items-start gap-3 dark:border-[#2a303a] dark:from-[#1c2028] dark:to-[#1c2028]">
        <div
          className="w-9 h-9 rounded-xl bg-white border border-gray-200/80 flex items-center justify-center shrink-0 dark:bg-[#171a20] dark:border-[#2a303a]"
          style={{ color: "#7A94B8" }}
        >
          <Sparkles size={18} strokeWidth={1.75} aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-[#f5f7fb]">Insights</p>
          <p className="text-xs text-gray-500 mt-0.5 dark:text-[#cfd6e2]">
            From your stored tasks, focus sessions, and agent runs (rolling window —
            UTC weekdays; see headline).
          </p>
        </div>
      </div>
      <div className="p-5 space-y-4">
        <p className="text-sm text-gray-800 leading-relaxed">{headline}</p>
        <ul className="space-y-2.5 list-none m-0 p-0">
          {bullets.map((line, i) => (
            <li
              key={`${i}-${line.slice(0, 24)}`}
              className="flex gap-3 text-sm text-gray-600 leading-snug"
            >
              <span
                className="mt-2 w-1.5 h-1.5 rounded-full shrink-0 bg-[#8FABD4]/90"
                aria-hidden
              />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function AssistantRecommendationsCard({ items }: { items: string[] }) {
  return (
    <Card className="overflow-hidden border-gray-200/90">
      <div className="px-5 py-4 border-b border-gray-100/90 bg-gradient-to-br from-[#F8F9FB] to-white flex items-start gap-3 dark:border-[#2a303a] dark:from-[#1c2028] dark:to-[#1c2028]">
        <div
          className="w-9 h-9 rounded-xl bg-white border border-gray-200/80 flex items-center justify-center shrink-0 dark:bg-[#171a20] dark:border-[#2a303a]"
          style={{ color: "#7A94B8" }}
        >
          <Lightbulb size={18} strokeWidth={1.75} aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-[#f5f7fb]">Recommendations</p>
          <p className="text-xs text-gray-500 mt-0.5 dark:text-[#cfd6e2]">
            Next steps tied to counts in the same activity sample — not generic filler.
          </p>
        </div>
      </div>
      <div className="p-5 space-y-3">
        {items.map((text, i) => (
          <div
            key={`${i}-${text.slice(0, 24)}`}
            className="rounded-xl border border-gray-100 bg-[#FAFAFA] px-4 py-3"
          >
            <p className="text-sm text-gray-700 leading-snug">{text}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function AnalyticsLoadingSkeleton() {
  return (
    <div className="space-y-10 animate-pulse" aria-hidden>
      <div className="h-40 rounded-2xl bg-gray-100" />
      <div className="h-52 rounded-2xl bg-gray-100" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-28 rounded-2xl bg-gray-100" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="h-72 rounded-2xl bg-gray-100" />
        <div className="h-72 rounded-2xl bg-gray-100" />
      </div>
    </div>
  );
}

const ACTIVITY_PATTERN_WINDOW_DAYS = 90;

export default function AnalyticsPage() {
  const [interval, setInterval] = useState<AnalyticsInterval>("week");
  const [data, setData] = useState<AnalyticsSlice | null>(null);
  const [activityPatterns, setActivityPatterns] =
    useState<ActivityPatternsDto | null>(null);
  const [patternsLoadError, setPatternsLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(null);
    setPatternsLoadError(null);
    setActivityPatterns(null);

    const dashboardP = fetchAnalyticsDashboard(interval);
    const patternsP = fetchActivityPatterns(ACTIVITY_PATTERN_WINDOW_DAYS).catch(
      (e) => {
        if (!cancelled) {
          setPatternsLoadError(
            e instanceof Error ? e.message : "Could not load activity patterns"
          );
        }
        return null;
      }
    );

    Promise.all([dashboardP, patternsP])
      .then(([dto, patternsDto]) => {
        if (cancelled) return;
        const slice = dashboardDtoToAnalyticsSlice(dto, interval);
        setData(slice);
        setActivityPatterns(patternsDto);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setData(null);
        setActivityPatterns(null);
        const msg = e instanceof Error ? e.message : "Could not load analytics";
        setError(msg === "Authentication required" ? "SIGN_IN_REQUIRED" : msg);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [interval]);

  const comparison = useMemo(() => {
    if (!data) return null;
    return compareProductivityScores(interval, data.current, data.previous);
  }, [interval, data]);

  const completion = useMemo(
    () => (data ? tasksCompletionRate(data.current) : 0),
    [data]
  );

  const summaryCards = useMemo(() => {
    if (!data) return [];
    const current = data.current;
    return [
      {
        key: "done",
        label: "Tasks completed",
        value: String(current.tasksCompleted),
        hint: "Tasks marked done in this range.",
        icon: <ListChecks size={18} className="text-black/70" />,
      },
      {
        key: "planned",
        label: "Tasks planned",
        value: String(current.tasksPlanned),
        hint: "Tasks with a due date in this range.",
        icon: <ListTodo size={18} className="text-black/70" />,
      },
      {
        key: "rate",
        label: "Completion rate",
        value: formatPercent(completion),
        hint: "Share of planned work you finished.",
        icon: <ClipboardCheck size={18} className="text-black/70" />,
      },
      {
        key: "focus",
        label: "Focus time",
        value: formatMins(current.focusMinutes),
        hint: "Focus sessions logged in this range.",
        icon: <Clock size={18} className="text-black/70" />,
      },
      {
        key: "session",
        label: "Average session",
        value: formatMins(current.avgSessionMinutes),
        hint: "Average focus session length in this range.",
        icon: <Activity size={18} className="text-black/70" />,
      },
      {
        key: "streak",
        label: "Streak",
        value:
          current.streakDays === 1
            ? "1 day"
            : `${current.streakDays} days`,
        hint: "Your app visit streak (activity ping).",
        icon: <Flame size={18} className="text-black/70" />,
      },
    ];
  }, [data, completion]);

  const aiInsights = useMemo(() => {
    if (activityPatterns) {
      return deriveInsightsFromActivityPatterns(activityPatterns);
    }
    if (patternsLoadError) {
      return {
        headline: "Activity patterns could not be loaded.",
        bullets: [
          `${patternsLoadError}. Charts and scores above still use your selected range.`,
        ],
      };
    }
    return { headline: "", bullets: [] as string[] };
  }, [activityPatterns, patternsLoadError]);

  const aiRecommendations = useMemo(() => {
    if (!activityPatterns) {
      return { items: [] as string[] };
    }
    return deriveRecommendationsFromActivityPatterns(activityPatterns);
  }, [activityPatterns]);

  const showContent = !loading && data && comparison;

  return (
    <div className="ff-page flex flex-col">
      <main className="max-w-6xl mx-auto px-6 pt-10 pb-20 space-y-10 w-full">
        <section className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight">Analytics</h1>
            <p className="text-gray-600">
              Focus, tasks, and productivity score from your real data.
            </p>
          </div>
          <IntervalSelector value={interval} onChange={setInterval} />
        </section>

        {error === "SIGN_IN_REQUIRED" ? (
          <Card className="p-6 max-w-md">
            <p className="text-sm text-gray-800">
              Sign in to load your analytics.
            </p>
            <Link
              href="/login"
              className="inline-block mt-3 text-sm font-medium text-[#5A7AA6] underline"
            >
              Go to login
            </Link>
          </Card>
        ) : null}

        {error && error !== "SIGN_IN_REQUIRED" ? (
          <Card className="p-6 border-amber-200 bg-amber-50/50 max-w-lg">
            <p className="text-sm text-gray-800">{error}</p>
            <p className="text-xs text-gray-600 mt-2">
              Check that the API is running and{" "}
              <code className="text-[11px] bg-white px-1 rounded">NEXT_PUBLIC_API_URL</code>{" "}
              is set.
            </p>
          </Card>
        ) : null}

        {!showContent && !error ? <AnalyticsLoadingSkeleton /> : null}

        {showContent ? (
          <>
            <DominantHeroCard data={data} comparison={comparison} />

            <ProductivityScoreCard
              interval={interval}
              comparison={comparison}
              compareLabel={data.compareLabel}
            />

            <section>
              <h2 className="text-sm font-semibold text-gray-900 mb-3">
                Summary
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {summaryCards.map((c) => (
                  <SummaryCard
                    key={c.key}
                    icon={c.icon}
                    label={c.label}
                    value={c.value}
                    hint={c.hint}
                  />
                ))}
              </div>
            </section>

            <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <ProductivityTrendChart
                values={data.trendBars}
                interval={interval}
              />
              <TaskLoadVsCompletedChart
                planned={data.loadBars}
                completed={data.completeBars}
                interval={interval}
              />
            </section>

            <section className="space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">
                  Insights & recommendations
                </h2>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <AssistantInsightsCard
                  headline={aiInsights.headline}
                  bullets={aiInsights.bullets}
                />
                <AssistantRecommendationsCard items={aiRecommendations.items} />
              </div>
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
