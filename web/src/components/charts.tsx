import type { ReactNode } from "react";
import { money } from "../lib/format";
import { useChartColors } from "../lib/theme";

/** Recharts custom tooltip that matches the app surface in both themes. */
export function ChartTooltip({
  active,
  label,
  payload,
  labelFormatter
}: {
  active?: boolean;
  label?: string | number;
  payload?: Array<{ name?: string; value?: number | string; color?: string }>;
  labelFormatter?: (label: string | number) => ReactNode;
}) {
  const c = useChartColors();
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-lg"
      style={{ background: c.surface, borderColor: c.grid, color: c.ink }}
    >
      {label !== undefined && (
        <div className="mb-1 font-medium">{labelFormatter ? labelFormatter(label) : label}</div>
      )}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 py-0.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span style={{ color: c.ink2 }}>{p.name}</span>
          <span className="tnum ml-auto pl-4 font-medium">
            {typeof p.value === "number" ? money(p.value) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Legend chip row (identity is never color-alone; labels sit next to swatches). */
export function LegendRow({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-ink2">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
