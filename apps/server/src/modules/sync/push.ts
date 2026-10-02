import type { EntityName, Mutation, MutationResult, RejectReason } from '@budget/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { reserveSeq, runBatch, seqFor } from '../../db/batch';
import type { Db } from '../../db/client';
import {
  auditLog,
  categories,
  expenses,
  memberships,
  processedMutations,
  settlements,
} from '../../db/schema';
import { toCategoryRow, toExpenseRow, toSettlementRow } from './mappers';

type Statement = BatchItem<'sqlite'>;
type Upsert = Extract<Mutation, { op: 'upsert' }>;
type Tombstone = Extract<Mutation, { op: 'delete' | 'restore' }>;

/** What we know about a row: from the database, or from an earlier mutation in the same push. */
interface Known {
  groupId: string;
  version: number;
  deletedAt: number | null;
  /** The row as the API shows it, for the audit log. */
  snapshot: unknown;
}

type Write =
  | { kind: 'upsert'; mutation: Upsert; version: number; before: unknown; after: unknown }
  | { kind: 'delete' | 'restore'; mutation: Tombstone; before: unknown; after: unknown };

interface Plan {
  results: MutationResult[];
  writes: Write[];
  /** Mutations that are valid but change nothing (delete of a deleted row): still recorded. */
  noops: Mutation[];
}

const entityIdOf = (m: Mutation) => (m.op === 'upsert' ? m.data.id : m.id);
const groupIdOf = (m: Mutation) => (m.op === 'upsert' ? m.data.groupId : m.groupId);
const key = (entity: EntityName, id: string) => `${entity}:${id}`;
const unique = <T>(items: T[]) => [...new Set(items)];

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
): Promise<MutationResult[]> {
  try {
    return await attempt(db, userId, mutations, now);
  } catch (error) {
    // The only expected failure is the same mutation arriving twice at once: the second batch
    // violates the primary key on processed_mutations and rolls back. Re-reading finds it
    // processed. Anything else fails again and surfaces.
    void error;
    return attempt(db, userId, mutations, now);
  }
}

async function attempt(
  db: Db,
  userId: string,
  mutations: Mutation[],
  now: number,
): Promise<MutationResult[]> {
  const done = await db
    .select({ id: processedMutations.mutationId })
    .from(processedMutations)
    .where(
      inArray(
        processedMutations.mutationId,
        mutations.map((m) => m.mutationId),
      ),
    );
  const doneIds = new Set(done.map((row) => row.id));
  const todo = mutations.filter((m) => !doneIds.has(m.mutationId));

  const plan = todo.length > 0 ? await planMutations(db, userId, todo, now) : null;
  const byId = new Map(plan?.results.map((r) => [r.mutationId, r]));

  if (plan) await commit(db, userId, plan, now);

  return mutations.map(
    (m) => byId.get(m.mutationId) ?? { mutationId: m.mutationId, status: 'duplicate' as const },
  );
}

async function planMutations(db: Db, userId: string, todo: Mutation[], now: number): Promise<Plan> {
  const groupIds = unique(todo.map(groupIdOf));
  const idsOf = (entity: EntityName) =>
    unique(todo.filter((m) => m.entity === entity).map(entityIdOf));
  const referencedCategories = unique(
    todo.flatMap((m) =>
      m.op === 'upsert' && m.entity === 'expense' && m.data.categoryId ? [m.data.categoryId] : [],
    ),
  );
  const categoryIds = unique([...idsOf('category'), ...referencedCategories]);

  const [memberRows, categoryRows, expenseRows, settlementRows] = await Promise.all([
    db
      .select({
        groupId: memberships.groupId,
        userId: memberships.userId,
        removedAt: memberships.removedAt,
      })
      .from(memberships)
      .where(inArray(memberships.groupId, groupIds)),
    categoryIds.length > 0
      ? db.select().from(categories).where(inArray(categories.id, categoryIds))
      : [],
    idsOf('expense').length > 0
      ? db
          .select()
          .from(expenses)
          .where(inArray(expenses.id, idsOf('expense')))
      : [],
    idsOf('settlement').length > 0
      ? db
          .select()
          .from(settlements)
          .where(inArray(settlements.id, idsOf('settlement')))
      : [],
  ]);

  // Only active members may write; anyone who was ever a member can still appear in an old split.
  const everMember = new Map<string, Set<string>>();
  const activeMember = new Set<string>();
  for (const row of memberRows) {
    if (!everMember.has(row.groupId)) everMember.set(row.groupId, new Set());
    everMember.get(row.groupId)?.add(row.userId);
    if (row.userId === userId && row.removedAt === null) activeMember.add(row.groupId);
  }

  const known = new Map<string, Known>();
  const remember = (entity: EntityName, row: Known & { id: string }) =>
    known.set(key(entity, row.id), row);
  for (const row of categoryRows) {
    remember('category', { ...row, snapshot: toCategoryRow(row) });
  }
  for (const row of expenseRows) remember('expense', { ...row, snapshot: toExpenseRow(row) });
  for (const row of settlementRows) {
    remember('settlement', { ...row, snapshot: toSettlementRow(row) });
  }

  const plan: Plan = { results: [], writes: [], noops: [] };
  const reject = (m: Mutation, reason: RejectReason) =>
    plan.results.push({ mutationId: m.mutationId, status: 'rejected', reason });
  const applied = (m: Mutation, version: number, conflict: boolean) =>
    plan.results.push({
      mutationId: m.mutationId,
      status: 'applied',
      version,
      ...(conflict ? { conflict: true } : {}),
    });

  for (const m of todo) {
    const groupId = groupIdOf(m);
    if (!activeMember.has(groupId)) {
      reject(m, 'not_a_member');
      continue;
    }
    const id = entityIdOf(m);
    const existing = known.get(key(m.entity, id));
    if (existing && existing.groupId !== groupId) {
      reject(m, 'group_mismatch');
      continue;
    }

    if (m.op === 'upsert') {
      if (existing?.deletedAt != null) {
        // A delete wins over a concurrent edit; undoing it is an explicit `restore`.
        reject(m, 'deleted');
        continue;
      }
      if (!referencesAreValid(m, groupId, everMember, known)) {
        reject(m, 'invalid_reference');
        continue;
      }
      const version = (existing?.version ?? 0) + 1;
      const conflict =
        existing !== undefined && m.baseVersion !== null && m.baseVersion < existing.version;
      const after = {
        ...m.data,
        version,
        updatedAt: now,
        updatedBy: userId,
        deletedAt: null,
        ...(m.entity === 'expense' || m.entity === 'settlement' ? { createdBy: userId } : {}),
      };
      plan.writes.push({
        kind: 'upsert',
        mutation: m,
        version,
        before: existing?.snapshot ?? null,
        after,
      });
      known.set(key(m.entity, id), { groupId, version, deletedAt: null, snapshot: after });
      applied(m, version, conflict);
      continue;
    }

    // delete / restore
    if (!existing) {
      reject(m, 'not_found');
      continue;
    }
    const wantDeleted = m.op === 'delete';
    if ((existing.deletedAt !== null) === wantDeleted) {
      plan.noops.push(m); // already in the requested state
      applied(m, existing.version, false);
      continue;
    }
    const version = existing.version + 1;
    const after = {
      ...(existing.snapshot as object),
      version,
      updatedAt: now,
      updatedBy: userId,
      deletedAt: wantDeleted ? now : null,
    };
    plan.writes.push({ kind: m.op, mutation: m, before: existing.snapshot, after });
    known.set(key(m.entity, id), {
      groupId,
      version,
      deletedAt: wantDeleted ? now : null,
      snapshot: after,
    });
    applied(m, version, false);
  }
  return plan;
}

/** Categories must exist in the same group; people in a split must belong to the group. */
function referencesAreValid(
  m: Upsert,
  groupId: string,
  everMember: Map<string, Set<string>>,
  known: Map<string, Known>,
): boolean {
  const members = everMember.get(groupId) ?? new Set<string>();
  switch (m.entity) {
    case 'category':
      return true;
    case 'expense': {
      const { categoryId, payers, shares } = m.data;
      if (categoryId !== null && known.get(key('category', categoryId))?.groupId !== groupId) {
        return false;
      }
      return [...payers, ...shares].every((p) => members.has(p.userId));
    }
    case 'settlement':
      return members.has(m.data.fromUser) && members.has(m.data.toUser);
  }
}

async function commit(db: Db, userId: string, plan: Plan, now: number): Promise<void> {
  const total = plan.writes.length;
  const statements: Statement[] = [];
  if (total > 0) statements.push(reserveSeq(db, total));

  plan.writes.forEach((write, i) => {
    const seq = seqFor(total, i + 1);
    statements.push(rowStatement(db, write, userId, now, seq));
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

  // One idempotency record per accepted mutation. The primary key is the guard.
  for (const m of [...plan.writes.map((w) => w.mutation), ...plan.noops]) {
    statements.push(
      db.insert(processedMutations).values({ mutationId: m.mutationId, userId, appliedAt: now }),
    );
  }
  await runBatch(db, statements);
}

type Seq = ReturnType<typeof seqFor>;

function rowStatement(db: Db, write: Write, userId: string, now: number, seq: Seq): Statement {
  if (write.kind === 'upsert') return upsertStatement(db, write.mutation, userId, now, seq);

  const set = {
    deletedAt: write.kind === 'delete' ? now : null,
    updatedAt: now,
    updatedBy: userId,
    serverSeq: seq,
  };
  const { id, groupId } = write.mutation;
  // Guarded on the current state so a race with another delete or restore changes nothing.
  const wantDeleted = write.kind === 'delete';
  switch (write.mutation.entity) {
    case 'category':
      return db
        .update(categories)
        .set({ ...set, version: sql`${categories.version} + 1` })
        .where(
          and(
            eq(categories.id, id),
            eq(categories.groupId, groupId),
            wantDeleted ? isNull(categories.deletedAt) : sql`${categories.deletedAt} IS NOT NULL`,
          ),
        );
    case 'expense':
      return db
        .update(expenses)
        .set({ ...set, version: sql`${expenses.version} + 1` })
        .where(
          and(
            eq(expenses.id, id),
            eq(expenses.groupId, groupId),
            wantDeleted ? isNull(expenses.deletedAt) : sql`${expenses.deletedAt} IS NOT NULL`,
          ),
        );
    case 'settlement':
      return db
        .update(settlements)
        .set({ ...set, version: sql`${settlements.version} + 1` })
        .where(
          and(
            eq(settlements.id, id),
            eq(settlements.groupId, groupId),
            wantDeleted ? isNull(settlements.deletedAt) : sql`${settlements.deletedAt} IS NOT NULL`,
          ),
        );
  }
}

/**
 * Insert-or-update. Last writer wins, but never over a tombstone and never across groups
 * (the `WHERE` on the update), so a concurrent delete or a forged group id changes nothing.
 */
function upsertStatement(db: Db, m: Upsert, userId: string, now: number, seq: Seq): Statement {
  const sync = { updatedAt: now, updatedBy: userId, serverSeq: seq };

  switch (m.entity) {
    case 'category': {
      const { data } = m;
      const fields = {
        name: data.name,
        icon: data.icon,
        color: data.color,
        archived: data.archived,
      };
      return db
        .insert(categories)
        .values({
          id: data.id,
          groupId: data.groupId,
          ...fields,
          version: 1,
          deletedAt: null,
          ...sync,
        })
        .onConflictDoUpdate({
          target: categories.id,
          set: { ...fields, ...sync, version: sql`${categories.version} + 1` },
          setWhere: and(isNull(categories.deletedAt), eq(categories.groupId, data.groupId)),
        });
    }
    case 'expense': {
      const { data } = m;
      const fields = {
        occurredOn: data.occurredOn,
        amountMinor: data.amountMinor,
        categoryId: data.categoryId,
        note: data.note,
        splitType: data.splitType,
        payers: data.payers,
        shares: data.shares,
      };
      return db
        .insert(expenses)
        .values({
          id: data.id,
          groupId: data.groupId,
          ...fields,
          createdBy: userId,
          version: 1,
          deletedAt: null,
          ...sync,
        })
        .onConflictDoUpdate({
          target: expenses.id,
          set: { ...fields, ...sync, version: sql`${expenses.version} + 1` },
          setWhere: and(isNull(expenses.deletedAt), eq(expenses.groupId, data.groupId)),
        });
    }
    case 'settlement': {
      const { data } = m;
      const fields = {
        fromUser: data.fromUser,
        toUser: data.toUser,
        amountMinor: data.amountMinor,
        occurredOn: data.occurredOn,
        note: data.note,
      };
      return db
        .insert(settlements)
        .values({
          id: data.id,
          groupId: data.groupId,
          ...fields,
          createdBy: userId,
          version: 1,
          deletedAt: null,
          ...sync,
        })
        .onConflictDoUpdate({
          target: settlements.id,
          set: { ...fields, ...sync, version: sql`${settlements.version} + 1` },
          setWhere: and(isNull(settlements.deletedAt), eq(settlements.groupId, data.groupId)),
        });
    }
  }
}
