import type { ExpenseData, SettlementData } from '@budget/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../../db/client';
import { expenses, settlements } from '../../../db/schema';
import type { Statement } from './types';
import type { syncFields } from './upsert-statement';

type Sync = ReturnType<typeof syncFields>;

/** An expense; `createdBy` is set when it is first stored and never changed by an edit. */
export function expenseStatement(db: Db, data: ExpenseData, userId: string, sync: Sync): Statement {
  const { id, groupId, occurredOn, amountMinor, categoryId, note, splitType, payers, shares } =
    data;
  const fields = { occurredOn, amountMinor, categoryId, note, splitType, payers, shares };
  return db
    .insert(expenses)
    .values({ id, groupId, ...fields, createdBy: userId, version: 1, deletedAt: null, ...sync })
    .onConflictDoUpdate({
      target: expenses.id,
      set: { ...fields, ...sync, version: sql`${expenses.version} + 1` },
      setWhere: and(isNull(expenses.deletedAt), eq(expenses.groupId, groupId)),
    });
}

/** A payment from one person to another; like an expense, its creator never changes. */
export function settlementStatement(
  db: Db,
  data: SettlementData,
  userId: string,
  sync: Sync,
): Statement {
  const { id, groupId, fromUser, toUser, amountMinor, occurredOn, note } = data;
  const fields = { fromUser, toUser, amountMinor, occurredOn, note };
  return db
    .insert(settlements)
    .values({ id, groupId, ...fields, createdBy: userId, version: 1, deletedAt: null, ...sync })
    .onConflictDoUpdate({
      target: settlements.id,
      set: { ...fields, ...sync, version: sql`${settlements.version} + 1` },
      setWhere: and(isNull(settlements.deletedAt), eq(settlements.groupId, groupId)),
    });
}
