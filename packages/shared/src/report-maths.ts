import { daysBetween } from './dates';
import type { CategoryTotal } from './reports';

/** Small sums the reports and budgets screens show next to the totals. */

/** Average per day over the days of a period, rounded to the nearest paisa. */
export function dailyAverage(totalMinor: number, days: number): number {
  return days > 0 ? Math.round(totalMinor / days) : 0;
}

/**
 * Days of a period that count towards an average: all of them once it is over, and only the days
 * so far (today included) while it is still running; none before it starts.
 */
export function daysElapsed(start: string, endExclusive: string, today: string): number {
  if (today < start) return 0;
  if (today >= endExclusive) return daysBetween(start, endExclusive);
  return daysBetween(start, today) + 1;
}

/** A part of a whole in basis points (1/100 of a percent), rounded; 0 when the whole is 0. */
export function shareBp(part: number, whole: number): number {
  return whole > 0 ? Math.round((part * 10_000) / whole) : 0;
}

/** How much a figure moved against an earlier one. `bp` is null when there was nothing before. */
export function changeBetween(
  previous: number,
  current: number,
): { deltaMinor: number; bp: number | null } {
  return {
    deltaMinor: current - previous,
    bp: previous > 0 ? Math.round(((current - previous) * 10_000) / previous) : null,
  };
}

/**
 * Keeps the biggest categories and folds the rest into one "other" total, so a chart stays
 * readable however many categories a group made.
 */
export function collapseTail(
  list: readonly CategoryTotal[],
  keep: number,
): { shown: CategoryTotal[]; other: { amountMinor: number; count: number } | null } {
  if (list.length <= keep) return { shown: [...list], other: null };
  const shown = list.slice(0, keep - 1);
  const rest = list.slice(keep - 1);
  return {
    shown,
    other: {
      amountMinor: rest.reduce((sum, c) => sum + c.amountMinor, 0),
      count: rest.reduce((sum, c) => sum + c.count, 0),
    },
  };
}
