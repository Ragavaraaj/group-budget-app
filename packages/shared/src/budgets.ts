import { type ReportExpense, shareBp, summarise } from './reports';

/**
 * Budgets are monthly spending limits for a group: one overall, and one per category. Where a
 * budget stands is worked out on the device from the group's expenses, so the warnings appear
 * even offline.
 */

/** A budget turns to a warning at 80% and to "over" at 100%. */
export const BUDGET_WARN_BP = 8_000;
export const BUDGET_OVER_BP = 10_000;

export type BudgetLevel = 'ok' | 'warn' | 'over';

export interface BudgetLike {
  id: string;
  /** `null` is the overall budget for the group. */
  categoryId: string | null;
  amountMinor: number;
}

export interface BudgetStatus {
  budgetId: string;
  categoryId: string | null;
  amountMinor: number;
  spentMinor: number;
  /** Negative when over. */
  remainingMinor: number;
  /** Spent as basis points of the budget, not capped at 100%. */
  usedBp: number;
  level: BudgetLevel;
}

export function budgetLevel(spentMinor: number, amountMinor: number): BudgetLevel {
  const used = shareBp(spentMinor, amountMinor);
  if (used >= BUDGET_OVER_BP) return 'over';
  if (used >= BUDGET_WARN_BP) return 'warn';
  return 'ok';
}

/**
 * Where each budget stands over a period. Spending is the group's whole spending (not one
 * person's share): a budget belongs to the group.
 */
export function evaluateBudgets(
  budgets: readonly BudgetLike[],
  expenses: readonly ReportExpense[],
  range: { start: string; endExclusive: string },
): BudgetStatus[] {
  const summary = summarise(expenses, { me: '', measure: 'total', ...range });
  const byCategory = new Map(summary.byCategory.map((c) => [c.categoryId, c.amountMinor]));

  return budgets.map((budget) => {
    const spentMinor =
      budget.categoryId === null ? summary.totalMinor : (byCategory.get(budget.categoryId) ?? 0);
    return {
      budgetId: budget.id,
      categoryId: budget.categoryId,
      amountMinor: budget.amountMinor,
      spentMinor,
      remainingMinor: budget.amountMinor - spentMinor,
      usedBp: shareBp(spentMinor, budget.amountMinor),
      level: budgetLevel(spentMinor, budget.amountMinor),
    };
  });
}

/**
 * Two devices can each set a budget for the same category while offline, and the sync keeps
 * both. The most recently changed one is the one that counts.
 */
export function newestPerCategory<T extends BudgetLike & { updatedAt: number }>(
  budgets: readonly T[],
): T[] {
  const best = new Map<string | null, T>();
  for (const budget of budgets) {
    const current = best.get(budget.categoryId);
    if (!current || budget.updatedAt > current.updatedAt) best.set(budget.categoryId, budget);
  }
  return [...best.values()];
}
