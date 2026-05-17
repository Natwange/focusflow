"use client";

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
  planned: number[];
  completed: number[];
  interval: AnalyticsInterval;
  className?: string;
};

const VB_W = 400;
const VB_H = 140;
const PAD_L = 40;
const PAD_R = 8;
const PAD_T = 16;
const PAD_B = 36;

const LAYOUT: ChartLayout = {
  vbW: VB_W,
  vbH: VB_H,
  padL: PAD_L,
  padR: PAD_R,
  padT: PAD_T,
  padB: PAD_B,
};

function normalizePair(planned: number[], completed: number[]) {
  const n = Math.min(planned.length, completed.length);
  const sliceP = planned.slice(0, n);
  const sliceC = completed.slice(0, n);
  const maxCount = Math.max(0, ...sliceP, ...sliceC);
  const max = Math.max(1, maxCount);
  const pad = max * 0.08;
  const hi = max + pad;
  return {
    n,
    maxCount,
    normP: sliceP.map((v) => v / hi),
    normC: sliceC.map((v) => v / hi),
    sliceP,
    sliceC,
  };
}

function linePath(norm: number[]): string {
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

function taskCountLabel(n: number): string {
  const v = Math.round(n);
  return `${v} task${v === 1 ? "" : "s"}`;
}

/** Planned load vs completed — gaps suggest heavier load than closure. */
export function TaskLoadVsCompletedChart({
  planned,
  completed,
  interval,
  className,
}: Props) {
  const { normP, normC, n, maxCount, sliceP, sliceC } = normalizePair(planned, completed);
  const pathP = linePath(normP);
  const pathC = linePath(normC);
  const labels = trendRangeLabels(interval);
  const bucketLabels = trendBucketLabels(interval, n);
  const ysP = chartYs(normP, LAYOUT);
  const ysC = chartYs(normC, LAYOUT);
  const topYLabel =
    maxCount <= 0 ? "0 tasks" : `${maxCount} task${maxCount === 1 ? "" : "s"} max`;

  return (
    <AnalyticsChartCard
      className={className}
      title="Tasks due vs tasks done"
      subtitle="Per time slice: tasks with a due date (planned) vs marked done (completed). Hover a point for exact counts."
      icon={
        <svg width={18} height={18} viewBox="0 0 18 18" aria-hidden>
          <path
            d="M3 14V6M9 14V4M15 14v-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            className="text-gray-400"
          />
        </svg>
      }
    >
      <div className="flex items-center gap-5 text-[11px] text-gray-500 mb-3">
        <span className="inline-flex items-center gap-2">
          <span
            className="w-5 h-0.5 rounded-full shrink-0"
            style={{ backgroundColor: CHART.loadLine }}
          />
          Planned (due)
        </span>
        <span className="inline-flex items-center gap-2">
          <span
            className="w-5 h-0.5 rounded-full shrink-0"
            style={{ backgroundColor: CHART.completeLine }}
          />
          Completed (done)
        </span>
      </div>

      <div className="rounded-xl border border-gray-100 bg-[#FAFAFA] px-3 pt-2 pb-2">
        <InteractiveChart
          layout={LAYOUT}
          count={n}
          ariaLabel="Task counts: due in each slice vs completed in each slice"
          renderTooltip={(i) => (
            <div className="space-y-1">
              <p className="font-semibold text-gray-900 dark:text-neutral-100">
                {bucketLabels[i] ?? `Point ${i + 1}`}
              </p>
              <p className="tabular-nums text-gray-600 dark:text-neutral-400">
                <span
                  className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
                  style={{ backgroundColor: CHART.loadLine }}
                />
                {taskCountLabel(sliceP[i] ?? 0)} due
              </p>
              <p className="tabular-nums text-gray-600 dark:text-neutral-400">
                <span
                  className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
                  style={{ backgroundColor: CHART.completeLine }}
                />
                {taskCountLabel(sliceC[i] ?? 0)} done
              </p>
            </div>
          )}
        >
          {({ hoverIndex, xs }) => (
            <>
              <text
                x={4}
                y={PAD_T + 11}
                fontSize={10}
                fill="#6b7280"
                className="tabular-nums pointer-events-none"
              >
                {topYLabel}
              </text>
              <text
                x={4}
                y={VB_H - PAD_B - 2}
                fontSize={10}
                fill="#6b7280"
                className="tabular-nums pointer-events-none"
              >
                0 tasks
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
              {n > 0 && pathP ? (
                <path
                  d={pathP}
                  fill="none"
                  stroke={CHART.loadLine}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  opacity={0.95}
                  className="pointer-events-none"
                />
              ) : null}
              {n > 0 && pathC ? (
                <path
                  d={pathC}
                  fill="none"
                  stroke={CHART.completeLine}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  opacity={0.9}
                  className="pointer-events-none"
                />
              ) : null}
              {hoverIndex != null && xs[hoverIndex] != null ? (
                <g className="pointer-events-none" aria-hidden>
                  <line
                    x1={xs[hoverIndex]}
                    y1={PAD_T}
                    x2={xs[hoverIndex]}
                    y2={VB_H - PAD_B}
                    stroke="#9ca3af"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    vectorEffect="non-scaling-stroke"
                  />
                  {ysP[hoverIndex] != null ? (
                    <circle
                      cx={xs[hoverIndex]}
                      cy={ysP[hoverIndex]}
                      r={4}
                      fill={CHART.loadLine}
                      stroke="#fff"
                      strokeWidth={1.5}
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : null}
                  {ysC[hoverIndex] != null ? (
                    <circle
                      cx={xs[hoverIndex]}
                      cy={ysC[hoverIndex]}
                      r={4}
                      fill={CHART.completeLine}
                      stroke="#fff"
                      strokeWidth={1.5}
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : null}
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
          Both lines share the same scale. Hover any point to see due vs done counts for
          that slice.
        </p>
      </div>
    </AnalyticsChartCard>
  );
}
