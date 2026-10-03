import type { RecurringData } from '@budget/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../../db/client';
import { recurringRules } from '../../../db/schema';
import type { RecurringServer, Statement, UpsertWrite } from './types';
import type { syncFields } from './upsert-statement';

/** A recurring rule: the template from the client, the schedule from `recurringServerFields`. */
export function recurringStatement(
  db: Db,
  data: RecurringData,
  write: UpsertWrite,
  sync: ReturnType<typeof syncFields>,
): Statement {
  const { id, groupId, frequency, startOn, endOn, active, amountMinor, categoryId, note } = data;
  const { splitType, payers, shares } = data;
  const fields = {
    frequency,
    startOn,
    endOn,
    active,
    amountMinor,
    categoryId,
    note,
    splitType,
    payers,
    shares,
  };
  const { createdBy, lastGeneratedOn, nextDueOn, resumed, tookOver } =
    write.server as RecurringServer;
  return db
    .insert(recurringRules)
    .values({
      id,
      groupId,
      ...fields,
      createdBy,
      lastGeneratedOn,
      nextDueOn,
      version: 1,
      deletedAt: null,
      ...sync,
    })
    .onConflictDoUpdate({
      target: recurringRules.id,
      // `createdBy` changes only when the creator has left and an editor takes the rule over.
      // The last date made only moves when a paused rule resumes: otherwise the scheduled job
      // may have moved it since this was planned.
      set: {
        ...fields,
        nextDueOn,
        ...(tookOver ? { createdBy } : {}),
        ...(resumed ? { lastGeneratedOn } : {}),
        ...sync,
        version: sql`${recurringRules.version} + 1`,
      },
      setWhere: and(isNull(recurringRules.deletedAt), eq(recurringRules.groupId, groupId)),
    });
}
