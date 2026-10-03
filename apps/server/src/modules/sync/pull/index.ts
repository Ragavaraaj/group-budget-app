import type { PullResponse } from '@budget/shared';
import type { Db } from '../../../db/client';
import { toCategoryRow, toExpenseRow, toGroupRow, toMemberRow, toSettlementRow } from '../mappers';
import { toBudgetRow, toRecurringRow } from '../mappers-planning';
import { mergeMembers } from './members';
import { assemble, page } from './page';
import { type PullOptions, pullQueries } from './queries';

export type { PullOptions };

/**
 * Everything that changed in the caller's groups since `since`, oldest change first, in pages.
 * All reads happen in one D1 batch, so they see one consistent snapshot (data model, rule 6).
 * Null when the caller asked for one group they don't belong to: a caller error, not an empty page.
 */
export async function pullChanges(
  db: Db,
  userId: string,
  options: PullOptions,
): Promise<PullResponse | null> {
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
  ] = await db.batch(pullQueries(db, userId, options));
  if (options.groupId && access.length === 0) return null;

  const { limit } = options;
  const pages = {
    groups: page(groupRows.map(toGroupRow), limit),
    members: page(mergeMembers(groupMembers, ownMembers).map(toMemberRow), limit),
    categories: page(categoryRows.map(toCategoryRow), limit),
    expenses: page(expenseRows.map(toExpenseRow), limit),
    settlements: page(settlementRows.map(toSettlementRow), limit),
    budgets: page(budgetRows.map(toBudgetRow), limit),
    recurring: page(recurringRows.map(toRecurringRow), limit),
  };
  // The two member queries were limited separately; if either was cut, the merged list is too.
  if (groupMembers.length > limit || ownMembers.length > limit) pages.members.truncated = true;
  return assemble(pages, options.since);
}
