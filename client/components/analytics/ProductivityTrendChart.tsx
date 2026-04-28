"use client";

import { useId } from "react";
import type { AnalyticsInterval } from "@/lib/productivityScore";
import { trendRangeLabels } from "@/lib/analyticsChartLabels";
import { AnalyticsChartCard } from "./AnalyticsChartCard";
import { CHART } from "./chartTheme";

type Props = {
  /** Relative productivity per step (mock); scaled visually, not raw units */
  values: number[];
  interval: AnalyticsInterval;
  className?: string;
};

const VB_W = 400;
const VB_H = 132;
const PAD_L = 8;
const PAD_R = 8;
const PAD_T = 12;
const PAD_B = 36;

function normalizeValues(values: number[]): { min: number; max: number; norm: number[] } {
  if (values.length === 0) {
    return { min: 0, max: 1, norm: [] };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = span * 0.12;
  const lo = min - pad;
  const hi = max + pad;
  const range = hi - lo || 1;
  return {
    min: lo,
    max: hi,
    norm: values.map((v) => (v - lo) / range),
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

/**
 * Soft area + line trend — productivity over the selected period (mock series).
 */
export function ProductivityTrendChart({ values, interval, className }: Props) {
  const gradId = useId().replace(/:/g, "");
  const { norm } = normalizeValues(values);
  const areaPath = buildAreaPath(norm);
  const linePath = buildLinePath(norm);
  const labels = trendRangeLabels(interval);

  const aria =
    interval === "day"
      ? "Productivity trend from morning through evening"
      : interval === "week"
        ? "Productivity trend Monday through Sunday"
        : "Productivity trend from early to late in the month";

  return (
    <AnalyticsChartCard
      className={className}
      title="Productivity trend"
      subtitle="How your rhythm moves across this period"
      icon={<div className="w-4 h-4 rounded-full bg-[#8FABD4]/45" aria-hidden />}
    >
      <div className="rounded-xl border border-gray-100 bg-[#FAFAFA] px-3 pt-3 pb-2">
        <svg
          className="w-full h-[200px] block"
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={aria}
        >
          <defs>
            <linearGradient id="ffProdFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART.accentFillTop} />
              <stop offset="100%" stopColor={CHART.accentFillBottom} />
            </linearGradient>
          </defs>
          {/* One soft horizontal guide */}
          <line
            x1={PAD_L}
            y1={(PAD_T + (VB_H - PAD_B - PAD_T) / 2).toFixed(2)}
            x2={VB_W - PAD_R}
            y2={(PAD_T + (VB_H - PAD_B - PAD_T) / 2).toFixed(2)}
            stroke={CHART.grid}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          {areaPath ? (
            <path d={areaPath} fill={`url(#${gradId})`} stroke="none" />
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
            />
          ) : null}
        </svg>
        <div className="flex justify-between px-1 pb-1 text-[11px] text-gray-400 tracking-wide">
          <span>{labels.start}</span>
          <span>{labels.mid}</span>
          <span>{labels.end}</span>
        </div>
      </div>
    </AnalyticsChartCard>
  );
}
