"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";

export type ChartLayout = {
  vbW: number;
  vbH: number;
  padL: number;
  padR: number;
  padT: number;
  padB: number;
};

export function chartXs(n: number, layout: ChartLayout): number[] {
  const innerW = layout.vbW - layout.padL - layout.padR;
  if (n <= 0) return [];
  if (n === 1) return [layout.padL + innerW / 2];
  return Array.from({ length: n }, (_, i) => layout.padL + (innerW * i) / (n - 1));
}

export function chartYs(norm: number[], layout: ChartLayout): number[] {
  const innerH = layout.vbH - layout.padT - layout.padB;
  return norm.map((t) => layout.padT + innerH * (1 - t));
}

type InteractiveChartProps = {
  layout: ChartLayout;
  count: number;
  className?: string;
  ariaLabel: string;
  children: (ctx: {
    hoverIndex: number | null;
    xs: number[];
  }) => ReactNode;
  renderTooltip: (index: number) => ReactNode;
};

export function InteractiveChart({
  layout,
  count,
  className,
  ariaLabel,
  children,
  renderTooltip,
}: InteractiveChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ left: number; top: number } | null>(
    null
  );

  const xs =
    count > 0
      ? chartXs(count, layout)
      : [];

  const clearHover = useCallback(() => {
    setHoverIndex(null);
    setTooltipPos(null);
  }, []);

  const onZoneEnter = (index: number, e: React.MouseEvent) => {
    setHoverIndex(index);
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    setTooltipPos({
      left: e.clientX - rect.left,
      top: e.clientY - rect.top,
    });
  };

  const onZoneMove = (index: number, e: React.MouseEvent) => {
    if (hoverIndex !== index) setHoverIndex(index);
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    setTooltipPos({
      left: e.clientX - rect.left,
      top: e.clientY - rect.top,
    });
  };

  const innerW = layout.vbW - layout.padL - layout.padR;
  const innerH = layout.vbH - layout.padT - layout.padB;
  const zoneW = count > 0 ? innerW / count : 0;

  return (
    <div ref={wrapRef} className="relative">
      <svg
        className={className ?? "w-full h-[200px] block cursor-crosshair"}
        viewBox={`0 0 ${layout.vbW} ${layout.vbH}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel}
        onMouseLeave={clearHover}
      >
        {children({ hoverIndex, xs })}
        {count > 0 &&
          xs.map((x, i) => (
            <rect
              key={i}
              x={x - zoneW / 2}
              y={layout.padT}
              width={zoneW}
              height={innerH}
              fill="transparent"
              className="cursor-pointer"
              onMouseEnter={(e) => onZoneEnter(i, e)}
              onMouseMove={(e) => onZoneMove(i, e)}
            />
          ))}
      </svg>
      {hoverIndex != null && tooltipPos ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+8px)] rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 shadow-md dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
          style={{ left: tooltipPos.left, top: tooltipPos.top }}
        >
          {renderTooltip(hoverIndex)}
        </div>
      ) : null}
    </div>
  );
}
