import { reserveSeq, runBatch, seqFor } from '../../../db/batch';
import type { Db } from '../../../db/client';
import { auditLog, processedMutations } from '../../../db/schema';
import { tombstoneStatement } from './tombstone-statement';
import { entityIdOf, groupIdOf, type Plan, type Statement } from './types';
import { upsertStatement } from './upsert-statement';

/**
 * Writes the plan as one atomic batch: the rows with their change numbers, one audit row each,
 * and one idempotency record per accepted mutation (whose primary key is the duplicate guard).
 */
export async function commit(db: Db, userId: string, plan: Plan, now: number): Promise<void> {
  const total = plan.writes.length;
  const statements: Statement[] = [];
  if (total > 0) statements.push(reserveSeq(db, total));

  plan.writes.forEach((write, i) => {
    const seq = seqFor(total, i + 1);
    statements.push(
      write.kind === 'upsert'
        ? upsertStatement(db, write, userId, now, seq)
        : tombstoneStatement(db, write, userId, now, seq),
    );
    const m = write.mutation;
    statements.push(
      db.insert(auditLog).values({
        mutationId: m.mutationId,
        userId,
        groupId: groupIdOf(m),
        entity: m.entity,
        entityId: entityIdOf(m),
        before: write.before,
        after: write.after,
        at: now,
      }),
    );
  });

  for (const m of [...plan.writes.map((w) => w.mutation), ...plan.noops]) {
    statements.push(
      db.insert(processedMutations).values({ mutationId: m.mutationId, userId, appliedAt: now }),
    );
  }
  await runBatch(db, statements);
}
