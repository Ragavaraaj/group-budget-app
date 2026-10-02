import type { LocalBudget, LocalCategory } from '@/db/types';

/** The "for" value of a budget that covers all spending. */
export const OVERALL = 'all';

export interface BudgetChoice {
  id: string;
  name: string;
}

/**
 * What a budget can be set for: everything, or a category, leaving out whatever already has one.
 * An existing budget keeps its own target. Empty when everything is covered, and then there is
 * nothing to add: a second budget for the same thing would only be hidden behind the first (and
 * still count towards the group's limit).
 */
export function budgetChoices(
  categories: readonly LocalCategory[],
  budgets: readonly LocalBudget[],
  existing?: LocalBudget,
): BudgetChoice[] {
  const taken = new Set(budgets.map((b) => b.categoryId));
  return [
    ...(taken.has(null) && existing?.categoryId !== null
      ? []
      : [{ id: OVERALL, name: 'Everything' }]),
    ...categories
      .filter((c) => !taken.has(c.id) || c.id === existing?.categoryId)
      .map((c) => ({ id: c.id, name: c.name })),
  ];
}
