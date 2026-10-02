import { daysBetween } from './dates';
import { DEFAULT_MONTH_START_DAY, periodKeyOf } from './periods';

/**
 * Report maths over a group's expenses. Pure functions of the rows, run on the device, so the
 * insights work offline and agree with the balances (which are derived the same way).
 */

/** The parts of an expense a report looks at. */
export interface ReportExpense {
  occurredOn: string;
  amountMinor: number;
  categoryId: string | null;
  shares: readonly { userId: string; amountMinor: number }[];
  deletedAt: number | null;
}

/**
 * What an amount means:
 * - `mine`: the person's own share — what they actually consumed, whoever paid.
 * - `total`: the whole expense, for "what did the group spend".
 */
export type Measure = 'mine' | 'total';

/** The paise an expense counts for under a measure. */
export function spendOf(expense: ReportExpense, me: string, measure: Measure): number {
  if (measure === 'total') return expense.amountMinor;
  return expense.shares.find((share) => share.userId === me)?.amountMinor ?? 0;
}

export interface CategoryTotal {
  /** `null` is "no category". */
  categoryId: string | null;
  amountMinor: number;
  count: number;
}

export interface PeriodSummary {
  totalMinor: number;
  count: number;
  /** Biggest first; ties keep a stable order so the screen doesn't shuffle. */
  byCategory: CategoryTotal[];
}

export interface SummaryOptions {
  me: string;
  measure: Measure;
  /** First day counted. */
  start: string;
  /** First day not counted. */
  endExclusive: string;
}

/** Deleted expenses never count, and under `mine` neither do expenses the person isn't part of. */
export function summarise(
  expenses: readonly ReportExpense[],
  { me, measure, start, endExclusive }: SummaryOptions,
): PeriodSummary {
  const totals = new Map<string | null, CategoryTotal>();
  let totalMinor = 0;
  let count = 0;

  for (const expense of expenses) {
    if (expense.deletedAt !== null) continue;
    if (expense.occurredOn < start || expense.occurredOn >= endExclusive) continue;
    const spend = spendOf(expense, me, measure);
    if (spend <= 0) continue;

    totalMinor += spend;
    count += 1;
    const entry = totals.get(expense.categoryId) ?? {
      categoryId: expense.categoryId,
      amountMinor: 0,
      count: 0,
    };
    entry.amountMinor += spend;
    entry.count += 1;
    totals.set(expense.categoryId, entry);
  }

  const byCategory = [...totals.values()].sort(
    (a, b) =>
      b.amountMinor - a.amountMinor ||
      String(a.categoryId ?? '').localeCompare(String(b.categoryId ?? '')),
  );
  return { totalMinor, count, byCategory };
}

export interface TrendPoint {
  /** The period key. */
  key: string;
  totalMinor: number;
}

/** One total per period, in the order of `keys` (periods with nothing in them are zero). */
export function trend(
  expenses: readonly ReportExpense[],
  {
    me,
    measure,
    keys,
    startDay = DEFAULT_MONTH_START_DAY,
  }: { me: string; measure: Measure; keys: readonly string[]; startDay?: number },
): TrendPoint[] {
  const totals = new Map(keys.map((key) => [key, 0]));
  for (const expense of expenses) {
    if (expense.deletedAt !== null) continue;
    const key = periodKeyOf(expense.occurredOn, startDay);
    const current = totals.get(key);
    if (current === undefined) continue;
    totals.set(key, current + spendOf(expense, me, measure));
  }
  return keys.map((key) => ({ key, totalMinor: totals.get(key) ?? 0 }));
}

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
