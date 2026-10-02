import { eq, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Db } from './client';
import { syncCounter } from './schema';

type Statement = BatchItem<'sqlite'>;

/**
 * Runs statements as one atomic D1 batch: they all commit or none do. Returns nothing because
 * callers read first and then write; the batch is only the write step.
 */
export async function runBatch(db: Db, statements: Statement[]): Promise<void> {
  const [first, ...rest] = statements;
  if (!first) return;
  await db.batch([first, ...rest]);
}

/**
 * `server_seq` numbering (docs/data-model.md). A batch that writes `count` synced rows first
 * reserves `count` numbers with this statement...
 */
export function reserveSeq(db: Db, count: number): Statement {
  return db
    .update(syncCounter)
    .set({ value: sql`${syncCounter.value} + ${count}` })
    .where(eq(syncCounter.id, 1));
}

/**
 * ...then the i-th write (1-based) takes `counter - (count - i)`. D1 runs a batch atomically and
 * one at a time, so numbers are strictly increasing across batches and never interleave.
 */
export function seqFor(count: number, index: number) {
  return sql<number>`(SELECT value FROM sync_counter WHERE id = 1) - ${count - index}`;
}
