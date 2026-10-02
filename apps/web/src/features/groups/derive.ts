import { computeBalances, simplifyDebts, type Transfer } from '@budget/shared';
import type { LocalExpense, LocalMember, LocalSettlement } from '@/db/types';

export interface GroupMoney {
  /** Net balance per person, in paise. Positive: owed money. Negative: owes money. */
  balances: Map<string, number>;
  /** The fewest payments that would clear every balance. */
  transfers: Transfer[];
  /** Everyone who has a balance row, including people who left but still have money in play. */
  total: number;
}

/** Balances are always derived from the rows (never stored), so they can't drift. */
export function deriveMoney(
  expenses: readonly LocalExpense[],
  settlements: readonly LocalSettlement[],
): GroupMoney {
  const balances = computeBalances(
    expenses.filter((e) => e.deletedAt === null),
    settlements.filter((s) => s.deletedAt === null),
  );
  return {
    balances,
    transfers: simplifyDebts(balances),
    total: expenses.filter((e) => e.deletedAt === null).reduce((sum, e) => sum + e.amountMinor, 0),
  };
}

export type ActivityKind = 'added' | 'edited' | 'deleted';

export interface ActivityItem {
  key: string;
  at: number;
  by: string;
  kind: ActivityKind;
  what: 'expense' | 'payment';
  /** Note or category for an expense; "to <name>" for a payment is composed by the screen. */
  expense?: LocalExpense;
  settlement?: LocalSettlement;
}

const kindOf = (row: { version: number; deletedAt: number | null }): ActivityKind =>
  row.deletedAt !== null ? 'deleted' : row.version <= 1 ? 'added' : 'edited';

/**
 * A feed of what happened in a group, newest first, built from the rows themselves: each
 * row says who changed it last and when, so no separate log has to sync.
 */
export function buildActivity(
  expenses: readonly LocalExpense[],
  settlements: readonly LocalSettlement[],
  limit = 50,
): ActivityItem[] {
  const items: ActivityItem[] = [
    ...expenses.map((expense) => ({
      key: `e:${expense.id}`,
      at: expense.updatedAt,
      by: expense.updatedBy,
      kind: kindOf(expense),
      what: 'expense' as const,
      expense,
    })),
    ...settlements.map((settlement) => ({
      key: `s:${settlement.id}`,
      at: settlement.updatedAt,
      by: settlement.updatedBy,
      kind: kindOf(settlement),
      what: 'payment' as const,
      settlement,
    })),
  ];
  return items.sort((a, b) => b.at - a.at).slice(0, limit);
}

/** Active people first (you on top), then people who left but still appear in the money. */
export function orderMembers(members: readonly LocalMember[], me: string): LocalMember[] {
  return [...members].sort(
    (a, b) =>
      Number(a.removedAt !== null) - Number(b.removedAt !== null) ||
      Number(b.userId === me) - Number(a.userId === me) ||
      a.displayName.localeCompare(b.displayName),
  );
}
