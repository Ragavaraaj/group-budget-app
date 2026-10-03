import type { Mutation, MutationResult } from '@budget/shared';
import { inArray } from 'drizzle-orm';
import type { Db } from '../../../db/client';
import { processedMutations } from '../../../db/schema';
import { commit } from './commit';
import { planMutations } from './plan';

export { recurringServerFields } from './recurring';

/**
 * Applies a client's queued changes. Reads and validates first, then writes everything in one
 * atomic D1 batch (D1 has no interactive transactions): row upserts and tombstones, their
 * `server_seq` numbers, audit rows and the idempotency records. A retried push is harmless:
 * already-applied mutations are reported as duplicates.
 */
export async function pushMutations(
  db: Db,
  userId: string,
  mutations: Mutation[],
  now: number,
  /** Called once the changes are committed, with the people who should hear about them. */
  onCommitted?: (recipients: string[]) => void,
): Promise<MutationResult[]> {
  try {
    return await attempt(db, userId, mutations, now, onCommitted);
  } catch (error) {
    // The one failure worth retrying is the same mutation arriving twice at once: the second
    // batch violates the primary key on processed_mutations and rolls back whole, and a second
    // pass finds it already processed. Everything else (a transient D1 error, a constraint) is
    // rethrown as it is: retrying would repeat the same ~40 queries, and on the free plan's
    // 50-per-invocation cap hide the real error behind a quota one.
    if (!isDuplicateMutation(error)) throw error;
    return attempt(db, userId, mutations, now, onCommitted);
  }
}

/** Drizzle wraps the driver's error; SQLite's message (naming the table) is on `cause`. */
export function isDuplicateMutation(error: unknown): boolean {
  const text = `${error} ${(error as { cause?: unknown } | null)?.cause ?? ''}`;
  return /UNIQUE constraint failed: processed_mutations\./i.test(text);
}

async function attempt(
  db: Db,
  userId: string,
  mutations: Mutation[],
  now: number,
  onCommitted?: (recipients: string[]) => void,
): Promise<MutationResult[]> {
  const ids = mutations.map((m) => m.mutationId);
  const done = await db
    .select({ id: processedMutations.mutationId })
    .from(processedMutations)
    .where(inArray(processedMutations.mutationId, ids));
  const doneIds = new Set(done.map((row) => row.id));
  const todo = mutations.filter((m) => !doneIds.has(m.mutationId));

  const plan = todo.length > 0 ? await planMutations(db, userId, todo, now) : null;
  const byId = new Map(plan?.results.map((r) => [r.mutationId, r]));

  if (plan) {
    await commit(db, userId, plan, now);
    if (plan.writes.length > 0) onCommitted?.(plan.recipients);
  }

  return mutations.map(
    (m) => byId.get(m.mutationId) ?? { mutationId: m.mutationId, status: 'duplicate' as const },
  );
}
