/** What one expense counts for in a report. */

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
