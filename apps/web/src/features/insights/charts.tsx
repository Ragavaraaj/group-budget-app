import { formatPaise, shareBp } from '@budget/shared';
import { CategoryIcon } from '@/components/category-icon';
import { cn } from '@/lib/utils';
import type { BreakdownRow } from './breakdown';

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  /** The bar for the period being looked at. */
  selected?: boolean;
}

const WIDTH = 360;
const HEIGHT = 168;
const TOP = 8;
const LABEL_SPACE = 22;

/**
 * A plain SVG bar chart: one bar per period. Drawn by hand rather than with a chart library so
 * it adds nothing to the bundle, needs no inline styles (the app's CSP forbids them), and can
 * describe itself to a screen reader: the same figures are also given as a list.
 */
export function TrendChart({ data, caption }: { data: BarDatum[]; caption: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const plotHeight = HEIGHT - TOP - LABEL_SPACE;
  const slot = WIDTH / Math.max(1, data.length);
  const barWidth = Math.min(36, slot * 0.62);

  return (
    <figure className="space-y-2">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${caption}: ${data.map((d) => `${d.label} ${formatPaise(d.value)}`).join(', ')}`}
      >
        <line
          x1={0}
          x2={WIDTH}
          y1={HEIGHT - LABEL_SPACE}
          y2={HEIGHT - LABEL_SPACE}
          className="stroke-border"
        />
        {data.map((d, i) => {
          const height = d.value > 0 ? Math.max(2, (d.value / max) * plotHeight) : 0;
          const x = slot * i + (slot - barWidth) / 2;
          return (
            <g key={d.key}>
              <rect
                x={x}
                y={HEIGHT - LABEL_SPACE - height}
                width={barWidth}
                height={height}
                rx={3}
                className={d.selected ? 'fill-primary' : 'fill-primary/35'}
              />
              <text
                x={slot * i + slot / 2}
                y={HEIGHT - 6}
                textAnchor="middle"
                className={cn(
                  'fill-muted-foreground text-[11px]',
                  d.selected && 'fill-foreground font-medium',
                )}
              >
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="sr-only">{caption}</figcaption>
      <ul className="sr-only">
        {data.map((d) => (
          <li key={d.key}>
            {d.label}: {formatPaise(d.value)}
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** Spending by category as bars with their share of the total. */
export function CategoryBars({ rows, totalMinor }: { rows: BreakdownRow[]; totalMinor: number }) {
  return (
    <ul className="space-y-3">
      {rows.map((row) => {
        const percent = shareBp(row.amountMinor, totalMinor) / 100;
        return (
          <li key={row.key} className="space-y-1.5" data-testid="category-row">
            <div className="flex items-center gap-3">
              <CategoryIcon icon={row.icon} color={row.color} className="size-8 [&_svg]:size-4" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.name}</span>
              <span className="text-sm tabular-nums">{formatPaise(row.amountMinor)}</span>
              <span className="text-muted-foreground w-12 text-right text-xs tabular-nums">
                {percent < 1 && row.amountMinor > 0 ? '<1' : Math.round(percent)}%
              </span>
            </div>
            <div className="bg-muted h-1.5 overflow-hidden rounded-full" aria-hidden="true">
              <div
                className="bg-primary h-full rounded-full"
                style={{
                  width: `${Math.max(2, Math.min(100, percent))}%`,
                  ...(row.color ? { backgroundColor: row.color } : {}),
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
