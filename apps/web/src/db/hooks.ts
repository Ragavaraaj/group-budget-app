import { newestPerCategory, normaliseStartDay, periodRange } from '@budget/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useDb, useMe } from '@/auth/sync-context';
import { getMeta } from './database';
import type {
  LocalBudget,
  LocalCategory,
  LocalExpense,
  LocalGroup,
  LocalMember,
  LocalRecurring,
  LocalSettlement,
} from './types';

// Live views of the local database: they re-render when the data changes, whether because the
// person edited something or because a sync brought news. `undefined` means "still loading".

/** The groups this person is in: their personal ledger first, then the others by name. */
export function useGroups(): LocalGroup[] | undefined {
  const db = useDb();
  const { user } = useMe();
  return useLiveQuery(async () => {
    const mine = await db.members
      .where('userId')
      .equals(user.id)
      .filter((m) => m.removedAt === null)
      .toArray();
    const groups = (await db.groups.bulkGet(mine.map((m) => m.groupId))).filter(
      (g): g is LocalGroup => g !== undefined,
    );
    return groups.sort(
      (a, b) => Number(b.isPersonal) - Number(a.isPersonal) || a.name.localeCompare(b.name),
    );
  }, [db, user.id]);
}

export function useGroup(groupId: string | undefined): LocalGroup | undefined | null {
  const db = useDb();
  // null = loaded and not found; undefined = loading.
  return useLiveQuery(
    async () => (groupId ? ((await db.groups.get(groupId)) ?? null) : null),
    [db, groupId],
  );
}

/** Everyone who is or was in the group (people who left are kept so old expenses still name them). */
export function useMembers(groupId: string | undefined): LocalMember[] | undefined {
  const db = useDb();
  return useLiveQuery(
    () => (groupId ? db.members.where('groupId').equals(groupId).toArray() : []),
    [db, groupId],
  );
}

/** The people who have left, by group, for screens that explain what depends on them. */
export function useRemovedMembers(): Map<string, LocalMember[]> | undefined {
  const db = useDb();
  return useLiveQuery(async () => {
    const removed = await db.members.filter((m) => m.removedAt !== null).toArray();
    const byGroup = new Map<string, LocalMember[]>();
    for (const member of removed) {
      byGroup.set(member.groupId, [...(byGroup.get(member.groupId) ?? []), member]);
    }
    return byGroup;
  }, [db]);
}

/** Categories not deleted. Pass `includeArchived` for management screens. */
export function useCategories(
  groupId: string | undefined,
  { includeArchived = false } = {},
): LocalCategory[] | undefined {
  const db = useDb();
  return useLiveQuery(async () => {
    if (!groupId) return [];
    const rows = await db.categories.where('groupId').equals(groupId).toArray();
    return rows
      .filter((c) => c.deletedAt === null && (includeArchived || !c.archived))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [db, groupId, includeArchived]);
}

/** Every category of a group, deleted ones too, to put a name on old expenses. */
export function useCategoryLookup(
  groupId: string | undefined,
): Map<string, LocalCategory> | undefined {
  const db = useDb();
  return useLiveQuery(async () => {
    if (!groupId) return new Map();
    const rows = await db.categories.where('groupId').equals(groupId).toArray();
    return new Map(rows.map((c) => [c.id, c]));
  }, [db, groupId]);
}

const newestFirst = (a: LocalExpense, b: LocalExpense) =>
  b.occurredOn.localeCompare(a.occurredOn) || b.updatedAt - a.updatedAt;

export const MONTH_START_KEY = 'monthStartDay';

/**
 * The day a person's "month" starts on (1 = calendar months, 25 = salary cycles). A personal
 * setting kept in this device's local database for this person.
 */
export function useMonthStartDay(): number {
  const db = useDb();
  return useLiveQuery(async () => normaliseStartDay(await getMeta(db, MONTH_START_KEY)), [db]) ?? 1;
}

/**
 * Expenses of a group in one reporting period, newest first, deleted ones left out. `month` is
 * the period key ("2026-10"); with a start day of 25 that means 25 Oct to 24 Nov.
 */
export function useExpensesInMonth(
  groupId: string | undefined,
  month: string,
  startDay = 1,
): LocalExpense[] | undefined {
  const db = useDb();
  return useLiveQuery(async () => {
    if (!groupId) return [];
    const { start, endExclusive } = periodRange(month, startDay);
    const rows = await db.expenses
      .where('[groupId+occurredOn]')
      .between([groupId, start], [groupId, endExclusive], true, false)
      .toArray();
    return rows.filter((e) => e.deletedAt === null).sort(newestFirst);
  }, [db, groupId, month, startDay]);
}

/** All of a group's expenses including deleted ones (balances need the live ones; the activity feed wants both). */
export function useAllExpenses(groupId: string | undefined): LocalExpense[] | undefined {
  const db = useDb();
  return useLiveQuery(
    () => (groupId ? db.expenses.where('groupId').equals(groupId).toArray() : []),
    [db, groupId],
  );
}

export function useAllSettlements(groupId: string | undefined): LocalSettlement[] | undefined {
  const db = useDb();
  return useLiveQuery(
    () => (groupId ? db.settlements.where('groupId').equals(groupId).toArray() : []),
    [db, groupId],
  );
}

export function useExpense(id: string | undefined): LocalExpense | undefined | null {
  const db = useDb();
  return useLiveQuery(async () => (id ? ((await db.expenses.get(id)) ?? null) : null), [db, id]);
}

/** How a person is named in lists. People who left are still named, with a note. */
export function personName(members: readonly LocalMember[] | undefined, userId: string): string {
  const member = members?.find((m) => m.userId === userId);
  if (!member) return 'Former member';
  return member.removedAt === null ? member.displayName : `${member.displayName} (left)`;
}

/** Budgets of a group that are not deleted; if two exist for one category, the newest counts. */
export function useBudgets(groupId: string | undefined): LocalBudget[] | undefined {
  const db = useDb();
  return useLiveQuery(async () => {
    if (!groupId) return [];
    const rows = await db.budgets.where('groupId').equals(groupId).toArray();
    return newestPerCategory(rows.filter((b) => b.deletedAt === null));
  }, [db, groupId]);
}

/** Recurring rules in all of this person's groups, not deleted, soonest first by name. */
export function useRecurringRules(): LocalRecurring[] | undefined {
  const db = useDb();
  return useLiveQuery(async () => {
    const rows = await db.recurring.toArray();
    return rows.filter((r) => r.deletedAt === null).sort((a, b) => a.note.localeCompare(b.note));
  }, [db]);
}

/** Every expense (deleted ones left out) of the given groups, for reports and search. */
export function useExpensesOfGroups(
  groupIds: readonly string[] | undefined,
): LocalExpense[] | undefined {
  const db = useDb();
  const key = groupIds?.join(',');
  return useLiveQuery(async () => {
    if (!groupIds || groupIds.length === 0) return [];
    const rows = await db.expenses.where('groupId').anyOf(groupIds).toArray();
    return rows.filter((e) => e.deletedAt === null);
  }, [db, key]);
}

/** Categories of the given groups by id (deleted ones included, to name old expenses). */
export function useCategoriesOfGroups(
  groupIds: readonly string[] | undefined,
): Map<string, LocalCategory> | undefined {
  const db = useDb();
  const key = groupIds?.join(',');
  return useLiveQuery(async () => {
    if (!groupIds || groupIds.length === 0) return new Map();
    const rows = await db.categories.where('groupId').anyOf(groupIds).toArray();
    return new Map(rows.map((c) => [c.id, c]));
  }, [db, key]);
}

export function useRecurringRule(id: string | undefined): LocalRecurring | undefined | null {
  const db = useDb();
  // null = loaded and not found; undefined = loading.
  return useLiveQuery(async () => (id ? ((await db.recurring.get(id)) ?? null) : null), [db, id]);
}
