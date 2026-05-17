"use client";

import { useId } from "react";
import type { AnalyticsInterval } from "@/lib/productivityScore";
import { trendBucketLabels, trendRangeLabels } from "@/lib/analyticsChartLabels";
import { AnalyticsChartCard } from "./AnalyticsChartCard";
import { CHART } from "./chartTheme";
import {
  InteractiveChart,
  chartYs,
  type ChartLayout,
} from "./chartInteraction";

type Props = {
  /** Focus session minutes per bucket (from the API for this interval). */
  values: number[];
  interval: AnalyticsInterval;
  className?: string;
};

const VB_W = 400;
const VB_H = 132;
const PAD_L = 40;
const PAD_R = 8;
const PAD_T = 12;
const PAD_B = 36;

const LAYOUT: ChartLayout = {
  vbW: VB_W,
  vbH: VB_H,
  padL: PAD_L,
  padR: PAD_R,
  padT: PAD_T,
  padB: PAD_B,
};

/** Scale from 0 so height reads as “more minutes” toward the top. */
function normalizeValuesZeroBased(values: number[]): { maxRaw: number; hi: number; norm: number[] } {
  if (values.length === 0) {
    return { maxRaw: 0, hi: 1, norm: [] };
  }
  const maxRaw = Math.max(...values);
  const hi = Math.max(maxRaw * 1.08, 1);
  return {
    maxRaw,
    hi,
    norm: values.map((v) => v / hi),
  };
}

function buildAreaPath(norm: number[]): string {
  const n = norm.length;
  if (n === 0) return "";
  const innerW = VB_W - PAD_L - PAD_R;
  const innerH = VB_H - PAD_T - PAD_B;
  const bottom = VB_H - PAD_B;

  const xs =
    n === 1
      ? [PAD_L + innerW / 2]
      : norm.map((_, i) => PAD_L + (innerW * i) / (n - 1));
  const ys = norm.map((t) => PAD_T + innerH * (1 - t));

  let d = `M ${xs[0].toFixed(2)} ${bottom.toFixed(2)} L ${xs[0].toFixed(2)} ${ys[0].toFixed(2)}`;
  for (let i = 1; i < n; i++) {
    d += ` L ${xs[i].toFixed(2)} ${ys[i].toFixed(2)}`;
  }
  d += ` L ${xs[n - 1].toFixed(2)} ${bottom.toFixed(2)} Z`;
  return d;
}

function buildLinePath(norm: number[]): string {
  const n = norm.length;
  if (n === 0) return "";
  const innerW = VB_W - PAD_L - PAD_R;
  const innerH = VB_H - PAD_T - PAD_B;
  const xs =
    n === 1
      ? [PAD_L + innerW / 2]
      : norm.map((_, i) => PAD_L + (innerW * i) / (n - 1));
  const ys = norm.map((t) => PAD_T + innerH * (1 - t));
  let d = `M ${xs[0].toFixed(2)} ${ys[0].toFixed(2)}`;
  for (let i = 1; i < n; i++) {
    d += ` L ${xs[i].toFixed(2)} ${ys[i].toFixed(2)}`;
  }
  return d;
}

function formatFocusMinutes(mins: number): string {
  const m = Math.round(mins);
  if (m <= 0) return "0 min";
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h <= 0) return `${m} min`;
  if (r === 0) return `${h}h`;
  return `${h}h ${r}m`;
}

export function ProductivityTrendChart({ values, interval, className }: Props) {
  const gradId = `ff-prod-${useId().replace(/:/g, "")}`;
  const { norm, maxRaw } = normalizeValuesZeroBased(values);
  const areaPath = buildAreaPath(norm);
  const linePath = buildLinePath(norm);
  const labels = trendRangeLabels(interval);
  const bucketLabels = trendBucketLabels(interval, values.length);
  const ys = chartYs(norm, LAYOUT);
  const topLabel = maxRaw <= 0 ? "0 min" : `${Math.round(maxRaw)} min peak`;
  const bottomLabel = "0 min";

  const aria =
    interval === "day"
      ? "Focus minutes logged per part of today, morning through evening"
      : interval === "week"
        ? "Focus minutes logged per day Monday through Sunday"
        : "Focus minutes logged across the month from early to late";

  return (
    <AnalyticsChartCard
      className={className}
      title="Focus time by period"
      subtitle="Total focus session minutes in each slice of the range (your local timezone). Hover a point for exact minutes."
      icon={<div className="w-4 h-4 rounded-full bg-[#8FABD4]/45" aria-hidden />}
    >
      <div className="rounded-xl border border-gray-100 bg-[#FAFAFA] px-3 pt-3 pb-2">
        <InteractiveChart
          layout={LAYOUT}
          count={values.length}
          ariaLabel={aria}
          renderTooltip={(i) => (
            <div className="space-y-0.5">
              <p className="font-semibold text-gray-900 dark:text-neutral-100">
                {bucketLabels[i] ?? `Point ${i + 1}`}
              </p>
              <p className="tabular-nums text-gray-600 dark:text-neutral-400">
                {formatFocusMinutes(values[i] ?? 0)} focus
              </p>
            </div>
          )}
        >
          {({ hoverIndex, xs }) => (
            <>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART.accentFillTop} />
                  <stop offset="100%" stopColor={CHART.accentFillBottom} />
                </linearGradient>
              </defs>
              <text
                x={4}
                y={PAD_T + 11}
                fontSize={10}
                fill="#6b7280"
                className="tabular-nums pointer-events-none"
              >
                {topLabel}
              </text>
              <text
                x={4}
                y={VB_H - PAD_B - 2}
                fontSize={10}
                fill="#6b7280"
                className="tabular-nums pointer-events-none"
              >
                {bottomLabel}
              </text>
              <line
                x1={PAD_L}
                y1={(PAD_T + (VB_H - PAD_B - PAD_T) / 2).toFixed(2)}
                x2={VB_W - PAD_R}
                y2={(PAD_T + (VB_H - PAD_B - PAD_T) / 2).toFixed(2)}
                stroke={CHART.grid}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                className="pointer-events-none"
              />
              {areaPath ? (
                <path
                  d={areaPath}
                  fill={`url(#${gradId})`}
                  stroke="none"
                  className="pointer-events-none"
                />
              ) : null}
              {linePath ? (
                <path
                  d={linePath}
                  fill="none"
                  stroke={CHART.accent}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  opacity={0.92}
                  className="pointer-events-none"
                />
              ) : null}
              {hoverIndex != null && xs[hoverIndex] != null && ys[hoverIndex] != null ? (
                <g className="pointer-events-none" aria-hidden>
                  <line
                    x1={xs[hoverIndex]}
                    y1={PAD_T}
                    x2={xs[hoverIndex]}
                    y2={VB_H - PAD_B}
                    stroke={CHART.accent}
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    vectorEffect="non-scaling-stroke"
                    opacity={0.55}
                  />
                  <circle
                    cx={xs[hoverIndex]}
                    cy={ys[hoverIndex]}
                    r={4}
                    fill={CHART.accent}
                    stroke="#fff"
                    strokeWidth={1.5}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              ) : null}
            </>
          )}
        </InteractiveChart>
        <div className="flex justify-between px-1 pb-1 text-[11px] text-gray-400 tracking-wide">
          <span>{labels.start}</span>
          <span>{labels.mid}</span>
          <span>{labels.end}</span>
        </div>
        <p className="text-[11px] text-gray-500 mt-2 px-1 leading-snug">
          The line follows minutes from your focus timer. Hover any point to see the exact
          total for that slice.
        </p>
      </div>
    </AnalyticsChartCard>
  );
}
