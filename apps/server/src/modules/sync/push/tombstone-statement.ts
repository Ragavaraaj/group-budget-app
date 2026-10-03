import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { seqFor } from '../../../db/batch';
import type { Db } from '../../../db/client';
import { budgets, categories, expenses, recurringRules, settlements } from '../../../db/schema';
import type { Statement, TombstoneWrite } from './types';

const TABLES = {
  category: categories,
  expense: expenses,
  settlement: settlements,
  budget: budgets,
  recurring: recurringRules,
} as const;

/**
 * Deletes or restores a row. Guarded on the current state (and the group) so a race with another
 * delete or restore, or a forged group id, changes nothing.
 */
export function tombstoneStatement(
  db: Db,
  write: TombstoneWrite,
  userId: string,
  now: number,
  seq: ReturnType<typeof seqFor>,
): Statement {
  const { entity, id, groupId } = write.mutation;
  const deleting = write.kind === 'delete';
  const set = {
    deletedAt: deleting ? now : null,
    updatedAt: now,
    updatedBy: userId,
    serverSeq: seq,
  };
  const where = (table: (typeof TABLES)[keyof typeof TABLES]) =>
    and(
      eq(table.id, id),
      eq(table.groupId, groupId),
      deleting ? isNull(table.deletedAt) : isNotNull(table.deletedAt),
    );

  if (entity === 'recurring') {
    // Deleted: nothing due. Restored: starts again from today (`recurringTombstoneSchedule`).
    const schedule = write.schedule;
    return db
      .update(recurringRules)
      .set({
        ...set,
        ...(schedule ? { nextDueOn: schedule.nextDueOn } : {}),
        ...(schedule && !deleting ? { lastGeneratedOn: schedule.lastGeneratedOn } : {}),
        version: sql`${recurringRules.version} + 1`,
      })
      .where(where(recurringRules));
  }
  const table = TABLES[entity];
  return db
    .update(table)
    .set({ ...set, version: sql`${table.version} + 1` })
    .where(where(table));
}
