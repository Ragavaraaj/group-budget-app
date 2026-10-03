import { and, asc, eq, gt, inArray, isNull } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { Db } from '../../../db/client';
import {
  budgets,
  categories,
  expenses,
  groups,
  memberships,
  recurringRules,
  settlements,
} from '../../../db/schema';
import { memberQueries } from './members';

export interface PullOptions {
  since: number;
  limit: number;
  /** Only this group (used to fetch the full history of a group that was just joined). */
  groupId?: string;
}

type SyncTable =
  | typeof groups
  | typeof categories
  | typeof expenses
  | typeof settlements
  | typeof budgets
  | typeof recurringRules;

/**
 * The reads behind one page, to run as one D1 batch so they see one consistent snapshot. Each
 * fetches `limit + 1` rows, so "exactly limit" and "more to come" can be told apart, and every
 * one is served from a `(group_id, server_seq)` or `(user_id, server_seq)` index.
 */
export function pullQueries(db: Db, userId: string, options: PullOptions) {
  const { since, limit, groupId } = options;
  // Either one group (checked by the `access` query), or every group the caller is active in.
  const myGroups = db
    .select({ id: memberships.groupId })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), isNull(memberships.removedAt)));
  const inScope = (column: AnySQLiteColumn) =>
    groupId ? eq(column, groupId) : inArray(column, myGroups);
  const changed = <T extends SyncTable>(table: T, scope: AnySQLiteColumn) =>
    db
      .select()
      .from(table)
      .where(and(gt(table.serverSeq, since), inScope(scope)))
      .orderBy(asc(table.serverSeq))
      .limit(limit + 1);
  const members = memberQueries(db, userId, options, inScope);

  return [
    changed(groups, groups.id),
    members.inGroups,
    members.own,
    changed(categories, categories.groupId),
    changed(expenses, expenses.groupId),
    changed(settlements, settlements.groupId),
    changed(budgets, budgets.groupId),
    changed(recurringRules, recurringRules.groupId),
    members.access,
  ] as const;
}
