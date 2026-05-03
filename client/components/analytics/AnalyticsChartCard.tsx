import type { ReactNode } from "react";

type Props = {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
};

/**
 * Shared chrome for analytics charts — matches FocusFlow card style.
 */
export function AnalyticsChartCard({
  title,
  subtitle,
  icon,
  children,
  className = "",
}: Props) {
  return (
    <div
      className={`rounded-2xl border border-gray-200 bg-white p-6 shadow-sm ${className}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-gray-900">{title}</p>
          {subtitle ? (
            <p className="text-xs text-gray-500 mt-1">{subtitle}</p>
          ) : null}
        </div>
        {icon ? (
          <div className="w-10 h-10 rounded-xl bg-[#F9F9F9] flex items-center justify-center border border-gray-200 shrink-0">
            {icon}
          </div>
        ) : null}
      </div>
      <div className="mt-5">{children}</div>
    </div>
  );
}
