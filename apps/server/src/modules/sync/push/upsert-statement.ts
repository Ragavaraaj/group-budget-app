import { and, eq, isNull, sql } from 'drizzle-orm';
import type { seqFor } from '../../../db/batch';
import type { Db } from '../../../db/client';
import { budgets, categories } from '../../../db/schema';
import type { Statement, UpsertWrite } from './types';
import { expenseStatement, settlementStatement } from './upsert-ledger';
import { recurringStatement } from './upsert-recurring';

export type Seq = ReturnType<typeof seqFor>;

/** The columns every insert-or-update sets from who is writing and when. */
export const syncFields = (userId: string, now: number, seq: Seq) => ({
  updatedAt: now,
  updatedBy: userId,
  serverSeq: seq,
});

/**
 * Insert-or-update. Last writer wins, but never over a tombstone and never across groups
 * (the `WHERE` on the update), so a concurrent delete or a forged group id changes nothing.
 */
export function upsertStatement(
  db: Db,
  write: UpsertWrite,
  userId: string,
  now: number,
  seq: Seq,
): Statement {
  const m = write.mutation;
  const sync = syncFields(userId, now, seq);
  switch (m.entity) {
    case 'category': {
      const { id, groupId, name, icon, color, archived } = m.data;
      const fields = { name, icon, color, archived };
      return db
        .insert(categories)
        .values({ id, groupId, ...fields, version: 1, deletedAt: null, ...sync })
        .onConflictDoUpdate({
          target: categories.id,
          set: { ...fields, ...sync, version: sql`${categories.version} + 1` },
          setWhere: and(isNull(categories.deletedAt), eq(categories.groupId, groupId)),
        });
    }
    case 'budget': {
      const { id, groupId, categoryId, amountMinor } = m.data;
      const fields = { categoryId, amountMinor };
      return db
        .insert(budgets)
        .values({ id, groupId, ...fields, version: 1, deletedAt: null, ...sync })
        .onConflictDoUpdate({
          target: budgets.id,
          set: { ...fields, ...sync, version: sql`${budgets.version} + 1` },
          setWhere: and(isNull(budgets.deletedAt), eq(budgets.groupId, groupId)),
        });
    }
    case 'expense':
      return expenseStatement(db, m.data, userId, sync);
    case 'settlement':
      return settlementStatement(db, m.data, userId, sync);
    case 'recurring':
      return recurringStatement(db, m.data, write, sync);
  }
}
