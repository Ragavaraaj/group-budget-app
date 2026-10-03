import type { EntityName, Mutation } from '@budget/shared';
import { inArray } from 'drizzle-orm';
import type { Db } from '../../../db/client';
import {
  budgets,
  categories,
  expenses,
  memberships,
  recurringRules,
  settlements,
} from '../../../db/schema';
import { toCategoryRow, toExpenseRow, toSettlementRow } from '../mappers';
import { toBudgetRow, toRecurringRow } from '../mappers-planning';
import { entityIdOf, groupIdOf, type Known, key, type Members, unique } from './types';

/** Everything planning a push needs to know, read before anything is written. */
export interface Loaded {
  memberRows: { groupId: string; userId: string; removedAt: number | null }[];
  members: Members;
  /** The groups the person pushing is an active member of. */
  activeMember: Set<string>;
  known: Map<string, Known>;
}

type SyncTable =
  | typeof categories
  | typeof expenses
  | typeof settlements
  | typeof budgets
  | typeof recurringRules;

/** The rows of a table with these ids; no query at all when there are none. */
const withIds = <T extends SyncTable>(db: Db, table: T, ids: string[]) =>
  ids.length > 0 ? db.select().from(table).where(inArray(table.id, ids)) : Promise.resolve([]);

export async function loadForPush(db: Db, userId: string, todo: Mutation[]): Promise<Loaded> {
  const groupIds = unique(todo.map(groupIdOf));
  const idsOf = (entity: EntityName) =>
    unique(todo.filter((m) => m.entity === entity).map(entityIdOf));
  // Categories are read for the rows being written and for the ones those rows point at.
  const referenced = todo.flatMap((m) =>
    m.op === 'upsert' && m.entity !== 'category' && 'categoryId' in m.data && m.data.categoryId
      ? [m.data.categoryId]
      : [],
  );

  const [memberRows, categoryRows, expenseRows, settlementRows, budgetRows, recurringRows] =
    await Promise.all([
      db
        .select({
          groupId: memberships.groupId,
          userId: memberships.userId,
          removedAt: memberships.removedAt,
        })
        .from(memberships)
        .where(inArray(memberships.groupId, groupIds)),
      withIds(db, categories, unique([...idsOf('category'), ...referenced])),
      withIds(db, expenses, idsOf('expense')),
      withIds(db, settlements, idsOf('settlement')),
      withIds(db, budgets, idsOf('budget')),
      withIds(db, recurringRules, idsOf('recurring')),
    ]);

  // Only active members may write. Anyone who was ever a member can still appear in an old
  // expense's split, but a template for future ones (an active recurring rule) may name only
  // the people who are in the group now.
  const members: Members = { ever: new Map(), active: new Map() };
  const activeMember = new Set<string>();
  const add = (sets: Map<string, Set<string>>, groupId: string, id: string) =>
    sets.set(groupId, (sets.get(groupId) ?? new Set()).add(id));
  for (const row of memberRows) {
    add(members.ever, row.groupId, row.userId);
    if (row.removedAt !== null) continue;
    add(members.active, row.groupId, row.userId);
    if (row.userId === userId) activeMember.add(row.groupId);
  }

  const known = new Map<string, Known>();
  const remember = (entity: EntityName, row: Known & { id: string }) =>
    known.set(key(entity, row.id), row);
  for (const row of categoryRows) remember('category', { ...row, snapshot: toCategoryRow(row) });
  for (const row of expenseRows) remember('expense', { ...row, snapshot: toExpenseRow(row) });
  for (const row of settlementRows) {
    remember('settlement', { ...row, snapshot: toSettlementRow(row) });
  }
  for (const row of budgetRows) remember('budget', { ...row, snapshot: toBudgetRow(row) });
  for (const row of recurringRows) {
    remember('recurring', { ...row, snapshot: toRecurringRow(row) });
  }
  return { memberRows, members, activeMember, known };
}
