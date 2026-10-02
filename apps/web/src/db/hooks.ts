import { monthRange } from '@budget/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useDb, useMe } from '@/auth/sync-context';
import type {
  LocalCategory,
  LocalExpense,
  LocalGroup,
  LocalMember,
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

/** Expenses of a group in one month ("2026-10"), newest first, deleted ones left out. */
export function useExpensesInMonth(
  groupId: string | undefined,
  month: string,
): LocalExpense[] | undefined {
  const db = useDb();
  return useLiveQuery(async () => {
    if (!groupId) return [];
    const { start, endExclusive } = monthRange(month);
    const rows = await db.expenses
      .where('[groupId+occurredOn]')
      .between([groupId, start], [groupId, endExclusive], true, false)
      .toArray();
    return rows.filter((e) => e.deletedAt === null).sort(newestFirst);
  }, [db, groupId, month]);
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
