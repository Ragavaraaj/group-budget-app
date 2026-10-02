import { toRupeesString } from '@budget/shared';
import type { LocalCategory, LocalExpense } from '@/db/types';

export interface SearchFilters {
  /** Words that must all appear in the note, the category name, the amount or the date. */
  text: string;
  /** A category name (lower-cased), so one choice covers the same-named category in every group. */
  category: string | null;
  /** First and last day, "" for no limit. */
  from: string;
  to: string;
  /** Limits on the whole expense, in paise; `null` for no limit. */
  minMinor: number | null;
  maxMinor: number | null;
}

export const NO_FILTERS: SearchFilters = {
  text: '',
  category: null,
  from: '',
  to: '',
  minMinor: null,
  maxMinor: null,
};

/** True when nothing is being filtered, so the page can show a prompt instead of everything. */
export function isEmptySearch(filters: SearchFilters): boolean {
  return (
    filters.text.trim() === '' &&
    filters.category === null &&
    filters.from === '' &&
    filters.to === '' &&
    filters.minMinor === null &&
    filters.maxMinor === null
  );
}

const norm = (text: string) => text.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').trim();

/** Expenses that match every filter, newest first. Deleted expenses are never matched. */
export function filterExpenses(
  expenses: readonly LocalExpense[],
  filters: SearchFilters,
  categories: ReadonlyMap<string, LocalCategory>,
): LocalExpense[] {
  const words = norm(filters.text).split(/\s+/).filter(Boolean);

  return expenses
    .filter((expense) => {
      if (expense.deletedAt !== null) return false;
      if (filters.from && expense.occurredOn < filters.from) return false;
      if (filters.to && expense.occurredOn > filters.to) return false;
      if (filters.minMinor !== null && expense.amountMinor < filters.minMinor) return false;
      if (filters.maxMinor !== null && expense.amountMinor > filters.maxMinor) return false;

      const categoryName = expense.categoryId
        ? categories.get(expense.categoryId)?.name
        : undefined;
      if (filters.category !== null) {
        if (
          filters.category === 'none'
            ? categoryName !== undefined
            : norm(categoryName ?? '') !== filters.category
        ) {
          return false;
        }
      }

      if (words.length === 0) return true;
      const haystack = norm(
        [
          expense.note,
          categoryName ?? '',
          toRupeesString(expense.amountMinor),
          expense.occurredOn,
        ].join(' '),
      );
      return words.every((word) => haystack.includes(word));
    })
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.updatedAt - a.updatedAt);
}

/** The category names that can be filtered on, one per name across all the groups. */
export function categoryChoices(
  categories: Iterable<LocalCategory>,
): { value: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const category of categories) {
    if (category.deletedAt !== null) continue;
    const value = norm(category.name);
    if (!seen.has(value)) seen.set(value, category.name);
  }
  return [...seen.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
