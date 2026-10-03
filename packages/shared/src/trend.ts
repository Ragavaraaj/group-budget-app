import { DEFAULT_MONTH_START_DAY, periodKeyOf } from './periods';
import { type Measure, type ReportExpense, spendOf } from './spend';

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
