/**
 * Report maths over a group's expenses. Pure functions of the rows, run on the device, so the
 * insights work offline and agree with the balances (which are derived the same way).
 */

import { type Measure, type ReportExpense, spendOf } from './spend';

// The rest of the report maths, re-exported so callers find it all here.
export * from './report-maths';
export * from './spend';
export * from './trend';

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
