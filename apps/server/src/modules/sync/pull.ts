import { PULL_DEFAULT_LIMIT, type PullResponse } from '@budget/shared';
import { and, asc, eq, gt, inArray, isNull } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { Db } from '../../db/client';
import {
  budgets,
  categories,
  expenses,
  groups,
  memberships,
  recurringRules,
  settlements,
  users,
} from '../../db/schema';
import {
  type MemberJoinRow,
  toBudgetRow,
  toCategoryRow,
  toExpenseRow,
  toGroupRow,
  toMemberRow,
  toRecurringRow,
  toSettlementRow,
} from './mappers';

export interface PullOptions {
  since: number;
  limit: number;
  /** Only this group (used to fetch the full history of a group that was just joined). */
  groupId?: string;
}

interface Page<T> {
  rows: T[];
  truncated: boolean;
  /** Highest `server_seq` among the rows we kept. */
  last: number;
}

/** The queries fetch `limit + 1` rows so "exactly limit" and "more to come" can be told apart. */
function page<T extends { serverSeq: number }>(rows: T[], limit: number): Page<T> {
  const truncated = rows.length > limit;
  const kept = truncated ? rows.slice(0, limit) : rows;
  return { rows: kept, truncated, last: kept.at(-1)?.serverSeq ?? 0 };
}

/**
 * Everything that changed in the caller's groups since `since`, oldest change first, in pages.
 * All reads happen in one D1 batch, so they see one consistent snapshot, and every query is
 * served from a `(group_id, server_seq)` or `(user_id, server_seq)` index (data model, rule 6).
 */
export async function pullChanges(
  db: Db,
  userId: string,
  { since, limit, groupId }: PullOptions,
): Promise<PullResponse | null> {
  const take = limit + 1;

  // Either one group (checked below), or every group the caller is an active member of.
  const myGroups = db
    .select({ id: memberships.groupId })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), isNull(memberships.removedAt)));
  const inScope = (column: AnySQLiteColumn) =>
    groupId ? eq(column, groupId) : inArray(column, myGroups);

  const memberColumns = {
    groupId: memberships.groupId,
    userId: memberships.userId,
    role: memberships.role,
    joinedAt: memberships.joinedAt,
    removedAt: memberships.removedAt,
    serverSeq: memberships.serverSeq,
    displayName: users.displayName,
    avatarUrl: users.avatarUrl,
  };

  const [
    groupRows,
    groupMembers,
    ownMembers,
    categoryRows,
    expenseRows,
    settlementRows,
    budgetRows,
    recurringRows,
    access,
  ] = await db.batch([
    db
      .select()
      .from(groups)
      .where(
        and(
          gt(groups.serverSeq, since),
          groupId ? eq(groups.id, groupId) : inArray(groups.id, myGroups),
        ),
      )
      .orderBy(asc(groups.serverSeq))
      .limit(take),
    db
      .select(memberColumns)
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(gt(memberships.serverSeq, since), inScope(memberships.groupId)))
      .orderBy(asc(memberships.serverSeq))
      .limit(take),
    // The caller's own membership rows, including a removal, which must reach their devices
    // even though they can no longer see the group.
    groupId
      ? db
          .select(memberColumns)
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(
            and(
              eq(memberships.userId, userId),
              eq(memberships.groupId, groupId),
              gt(memberships.serverSeq, since),
            ),
          )
          .limit(1)
      : db
          .select(memberColumns)
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(and(eq(memberships.userId, userId), gt(memberships.serverSeq, since)))
          .orderBy(asc(memberships.serverSeq))
          .limit(take),
    db
      .select()
      .from(categories)
      .where(and(gt(categories.serverSeq, since), inScope(categories.groupId)))
      .orderBy(asc(categories.serverSeq))
      .limit(take),
    db
      .select()
      .from(expenses)
      .where(and(gt(expenses.serverSeq, since), inScope(expenses.groupId)))
      .orderBy(asc(expenses.serverSeq))
      .limit(take),
    db
      .select()
      .from(settlements)
      .where(and(gt(settlements.serverSeq, since), inScope(settlements.groupId)))
      .orderBy(asc(settlements.serverSeq))
      .limit(take),
    db
      .select()
      .from(budgets)
      .where(and(gt(budgets.serverSeq, since), inScope(budgets.groupId)))
      .orderBy(asc(budgets.serverSeq))
      .limit(take),
    db
      .select()
      .from(recurringRules)
      .where(and(gt(recurringRules.serverSeq, since), inScope(recurringRules.groupId)))
      .orderBy(asc(recurringRules.serverSeq))
      .limit(take),
    groupId
      ? db
          .select({ id: memberships.groupId })
          .from(memberships)
          .where(
            and(
              eq(memberships.userId, userId),
              eq(memberships.groupId, groupId),
              isNull(memberships.removedAt),
            ),
          )
          .limit(1)
      : db.select({ id: memberships.groupId }).from(memberships).limit(0),
  ]);

  // Asking for one group you don't belong to is a caller error, not an empty page.
  if (groupId && access.length === 0) return null;

  // A member row can come from both member queries; keep the newest.
  const memberMap = new Map<string, MemberJoinRow>();
  for (const row of [...groupMembers, ...ownMembers]) {
    const k = `${row.groupId}:${row.userId}`;
    if ((memberMap.get(k)?.serverSeq ?? 0) < row.serverSeq) memberMap.set(k, row);
  }
  const memberList = [...memberMap.values()].sort((a, b) => a.serverSeq - b.serverSeq);

  const pages = {
    groups: page(groupRows.map(toGroupRow), limit),
    members: page(memberList.map(toMemberRow), limit),
    categories: page(categoryRows.map(toCategoryRow), limit),
    expenses: page(expenseRows.map(toExpenseRow), limit),
    settlements: page(settlementRows.map(toSettlementRow), limit),
    budgets: page(budgetRows.map(toBudgetRow), limit),
    recurring: page(recurringRows.map(toRecurringRow), limit),
  };
  // The two member queries were limited separately; if either was cut, the merged list is too.
  if (groupMembers.length > limit || ownMembers.length > limit) pages.members.truncated = true;

  const all = Object.values(pages);
  const truncated = all.filter((p) => p.truncated);
  const hasMore = truncated.length > 0;
  // A truncated table has only been read up to its last row, so the page can only be trusted
  // up to the earliest such point; anything newer is picked up by the next page.
  const cursor = hasMore
    ? Math.min(...truncated.map((p) => p.last))
    : Math.max(since, ...all.map((p) => p.last));
  const upTo = <T extends { serverSeq: number }>(p: Page<T>) =>
    p.rows.filter((row) => row.serverSeq <= cursor);

  return {
    cursor,
    hasMore,
    groups: upTo(pages.groups),
    members: upTo(pages.members),
    categories: upTo(pages.categories),
    expenses: upTo(pages.expenses),
    settlements: upTo(pages.settlements),
    budgets: upTo(pages.budgets),
    recurring: upTo(pages.recurring),
  };
}

export { PULL_DEFAULT_LIMIT };
