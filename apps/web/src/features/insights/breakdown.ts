import type { CategoryTotal } from '@budget/shared';
import type { LocalCategory } from '@/db/types';

export interface BreakdownRow {
  /**
   * Stable key for lists: `cat:` and the lower-cased name, `none` for no category, and `other`
   * for the "Everything else" row (`limitRows`). A category called "Other" or "None" can't be
   * mistaken for either of those.
   */
  key: string;
  name: string;
  icon: string | undefined;
  color: string | undefined;
  amountMinor: number;
  count: number;
}

/**
 * Puts names on a category breakdown. Every group has its own "Food", so when several groups are
 * reported together categories with the same name are added up as one; a deleted or unknown
 * category and "no category" fall under "Uncategorised".
 */
export function nameCategories(
  totals: readonly CategoryTotal[],
  categories: ReadonlyMap<string, LocalCategory>,
): BreakdownRow[] {
  const rows = new Map<string, BreakdownRow>();
  for (const total of totals) {
    const category = total.categoryId ? categories.get(total.categoryId) : undefined;
    const name = category?.name ?? 'Uncategorised';
    const key = category ? `cat:${name.trim().toLowerCase()}` : 'none';
    const row = rows.get(key) ?? {
      key,
      name,
      icon: category?.icon,
      color: category?.color,
      amountMinor: 0,
      count: 0,
    };
    row.amountMinor += total.amountMinor;
    row.count += total.count;
    rows.set(key, row);
  }
  return [...rows.values()].sort(
    (a, b) => b.amountMinor - a.amountMinor || a.name.localeCompare(b.name),
  );
}

/** Keeps the biggest rows and folds the rest into one "Everything else" row, so a chart stays readable. */
export function limitRows(rows: readonly BreakdownRow[], keep: number): BreakdownRow[] {
  if (rows.length <= keep) return [...rows];
  const rest = rows.slice(keep - 1);
  return [
    ...rows.slice(0, keep - 1),
    {
      key: 'other',
      name: 'Everything else',
      icon: undefined,
      color: undefined,
      amountMinor: rest.reduce((sum, r) => sum + r.amountMinor, 0),
      count: rest.reduce((sum, r) => sum + r.count, 0),
    },
  ];
}
