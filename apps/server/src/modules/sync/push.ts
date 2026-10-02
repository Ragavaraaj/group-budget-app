import {
  addDays,
  type EntityName,
  MAX_BUDGETS_PER_GROUP,
  MAX_RECURRING_PER_GROUP,
  type Mutation,
  type MutationResult,
  nextOccurrence,
  RECURRING_MAX_BACKFILL_DAYS,
  type RecurringData,
  type RecurringRow,
  type RejectReason,
  toIndiaDate,
} from '@budget/shared';
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { reserveSeq, runBatch, seqFor } from '../../db/batch';
import type { Db } from '../../db/client';
import {
  auditLog,
  budgets,
  categories,
  expenses,
  memberships,
  processedMutations,
  recurringRules,
  settlements,
} from '../../db/schema';
import {
  toBudgetRow,
  toCategoryRow,
  toExpenseRow,
  toRecurringRow,
  toSettlementRow,
} from './mappers';

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

/** Where a recurring rule stands in its schedule. The scheduled job moves it on from there. */
interface Schedule {
  lastGeneratedOn: string | null;
  nextDueOn: string | null;
}

/** What the server itself decides about a recurring rule (see `recurringServerFields`). */
interface RecurringServer extends Schedule {
  createdBy: string;
  /** A paused rule was switched on again in this edit. */
  resumed: boolean;
  /** The creator had left the group, so this edit made the editor answerable for the rule. */
  tookOver: boolean;
}

type Write =
  | {
      kind: 'upsert';
      mutation: Upsert;
      version: number;
      before: unknown;
      after: unknown;
      server?: RecurringServer;
    }
  | {
      kind: 'delete' | 'restore';
      mutation: Tombstone;
      before: unknown;
      after: unknown;
      /** A recurring rule's schedule after the change (see `recurringTombstoneSchedule`). */
      schedule?: Schedule;
    };

interface Plan {
  results: MutationResult[];
  writes: Write[];
  /** Mutations that are valid but change nothing (delete of a deleted row): still recorded. */
  noops: Mutation[];
  /** The people in the groups being written to, who should be told about it. */
  recipients: string[];
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

  if (plan) {
    await commit(db, userId, plan, now);
    if (plan.writes.length > 0) onCommitted?.(plan.recipients);
  }

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
      m.op === 'upsert' &&
      (m.entity === 'expense' || m.entity === 'budget' || m.entity === 'recurring') &&
      m.data.categoryId
        ? [m.data.categoryId]
        : [],
    ),
  );
  const categoryIds = unique([...idsOf('category'), ...referencedCategories]);

  const [memberRows, categoryRows, expenseRows, settlementRows, budgetRows, recurringRows] =
    await Promise.all([
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
      idsOf('budget').length > 0
        ? db
            .select()
            .from(budgets)
            .where(inArray(budgets.id, idsOf('budget')))
        : [],
      idsOf('recurring').length > 0
        ? db
            .select()
            .from(recurringRules)
            .where(inArray(recurringRules.id, idsOf('recurring')))
        : [],
    ]);

  // Only active members may write. Anyone who was ever a member can still appear in an old
  // expense's split, but a template for future ones (an active recurring rule) may name only
  // the people who are in the group now.
  const members: Members = { ever: new Map(), active: new Map() };
  const activeMember = new Set<string>();
  const addMember = (sets: Map<string, Set<string>>, groupId: string, id: string) => {
    if (!sets.has(groupId)) sets.set(groupId, new Set());
    sets.get(groupId)?.add(id);
  };
  for (const row of memberRows) {
    addMember(members.ever, row.groupId, row.userId);
    if (row.removedAt !== null) continue;
    addMember(members.active, row.groupId, row.userId);
    if (row.userId === userId) activeMember.add(row.groupId);
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
  for (const row of budgetRows) remember('budget', { ...row, snapshot: toBudgetRow(row) });
  for (const row of recurringRows) {
    remember('recurring', { ...row, snapshot: toRecurringRow(row) });
  }

  // Groups can only hold so many budgets and rules. Counted only when something new is being
  // created, and per group, so the common push (expenses) pays nothing for it.
  const room = await roomLeft(db, todo, known);

  const plan: Plan = { results: [], writes: [], noops: [], recipients: [] };
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
      if (!referencesAreValid(m, groupId, members, known)) {
        reject(m, 'invalid_reference');
        continue;
      }
      if (existing === undefined && !room.take(m.entity, groupId)) {
        reject(m, 'limit_reached');
        continue;
      }
      const version = (existing?.version ?? 0) + 1;
      const conflict =
        existing !== undefined && m.baseVersion !== null && m.baseVersion < existing.version;
      const rule = existing?.snapshot as RecurringRow | undefined;
      const server =
        m.entity === 'recurring'
          ? recurringServerFields(
              m.data,
              rule,
              userId,
              now,
              rule !== undefined && !members.active.get(groupId)?.has(rule.createdBy),
            )
          : undefined;
      const after = {
        ...m.data,
        version,
        updatedAt: now,
        updatedBy: userId,
        deletedAt: null,
        ...(m.entity === 'expense' || m.entity === 'settlement' ? { createdBy: userId } : {}),
        ...(server
          ? {
              createdBy: server.createdBy,
              lastGeneratedOn: server.lastGeneratedOn,
              nextDueOn: server.nextDueOn,
            }
          : {}),
      };
      plan.writes.push({
        kind: 'upsert',
        mutation: m,
        version,
        before: existing?.snapshot ?? null,
        after,
        ...(server ? { server } : {}),
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
    // Restoring puts a row back among the group's budgets and rules, so it counts against the
    // cap; deleting one gives its place back, for what comes later in this same push.
    if (wantDeleted) room.release(m.entity, groupId);
    else if (!room.take(m.entity, groupId)) {
      reject(m, 'limit_reached');
      continue;
    }
    const version = existing.version + 1;
    const schedule =
      m.entity === 'recurring'
        ? recurringTombstoneSchedule(existing.snapshot as RecurringRow, wantDeleted, now)
        : undefined;
    const after = {
      ...(existing.snapshot as object),
      version,
      updatedAt: now,
      updatedBy: userId,
      deletedAt: wantDeleted ? now : null,
      ...schedule,
    };
    plan.writes.push({
      kind: m.op,
      mutation: m,
      before: existing.snapshot,
      after,
      ...(schedule ? { schedule } : {}),
    });
    known.set(key(m.entity, id), {
      groupId,
      version,
      deletedAt: wantDeleted ? now : null,
      snapshot: after,
    });
    applied(m, version, false);
  }
  const written = new Set(plan.writes.map((write) => groupIdOf(write.mutation)));
  plan.recipients = unique(
    memberRows
      .filter((row) => row.removedAt === null && written.has(row.groupId))
      .map((row) => row.userId),
  );
  return plan;
}

/** The people of each group: everyone who ever belonged, and those who belong now. */
interface Members {
  ever: Map<string, Set<string>>;
  active: Map<string, Set<string>>;
}

/** Categories must exist in the same group; people in a split must belong to the group. */
function referencesAreValid(
  m: Upsert,
  groupId: string,
  members: Members,
  known: Map<string, Known>,
): boolean {
  const ever = members.ever.get(groupId) ?? new Set<string>();
  switch (m.entity) {
    case 'category':
      return true;
    case 'expense': {
      const { categoryId, payers, shares } = m.data;
      if (categoryId !== null && known.get(key('category', categoryId))?.groupId !== groupId) {
        return false;
      }
      return [...payers, ...shares].every((p) => ever.has(p.userId));
    }
    case 'settlement':
      return ever.has(m.data.fromUser) && ever.has(m.data.toUser);
    case 'budget':
      return categoryIsInGroup(m.data.categoryId, groupId, known);
    case 'recurring': {
      const { categoryId, payers, shares } = m.data;
      // A template for future expenses must not name someone who has left: every month it would
      // add to their debt in a group they can't see. A paused rule makes none, so it may still be
      // saved (that is how a member pauses it) while it names them.
      const allowed = m.data.active ? (members.active.get(groupId) ?? new Set<string>()) : ever;
      return (
        categoryIsInGroup(categoryId, groupId, known) &&
        [...payers, ...shares].every((p) => allowed.has(p.userId))
      );
    }
  }
}

/** No category is fine; a named one must exist in this same group. */
const categoryIsInGroup = (categoryId: string | null, groupId: string, known: Map<string, Known>) =>
  categoryId === null || known.get(key('category', categoryId))?.groupId === groupId;

/**
 * Where a rule stands after an edit, worked out here because it is the server's to decide:
 * the day the next expense is due, and the last one made. A paused rule has no next date. A
 * rule that was paused and is switched on again starts from today rather than catching up on
 * what it missed, and no rule goes back further than `RECURRING_MAX_BACKFILL_DAYS`.
 *
 * A rule keeps its creator, who is the person the generated expenses are made on behalf of, until
 * that person has left the group. Then the rule would wait for ever, so whoever edits it next
 * takes it over (`creatorHasLeft`).
 */
export function recurringServerFields(
  data: RecurringData,
  existing: RecurringRow | undefined,
  userId: string,
  now: number,
  creatorHasLeft = false,
): RecurringServer {
  const resumed = existing !== undefined && !existing.active && data.active;
  const schedule = scheduleOf(data, existing?.lastGeneratedOn ?? null, now, resumed);
  const tookOver = existing !== undefined && creatorHasLeft;
  return {
    createdBy: existing && !creatorHasLeft ? existing.createdBy : userId,
    ...schedule,
    resumed,
    tookOver,
  };
}

/**
 * A rule's schedule after it is deleted (nothing is ever due while it is, so the job's index
 * doesn't carry it) or restored. An Undo soon after the delete (the same day in India) loses
 * nothing: the rule carries on from the last date it made, as if it had not been deleted. A rule
 * that was gone longer starts again from today, the same as a resumed one, so it never revives
 * dates from while it was deleted. Either way it goes back no further than the backfill floor.
 */
function recurringTombstoneSchedule(rule: RecurringRow, deleting: boolean, now: number): Schedule {
  if (deleting) return { lastGeneratedOn: rule.lastGeneratedOn, nextDueOn: null };
  const undo =
    rule.deletedAt !== null && toIndiaDate(new Date(rule.deletedAt)) === toIndiaDate(new Date(now));
  return scheduleOf(rule, rule.lastGeneratedOn, now, !undo);
}

function scheduleOf(
  data: RecurringData | RecurringRow,
  lastGeneratedOn: string | null,
  now: number,
  restart: boolean,
): Schedule {
  const today = toIndiaDate(new Date(now));
  let last = lastGeneratedOn;
  if (restart) {
    const yesterday = addDays(today, -1);
    if (last === null || last < yesterday) last = yesterday;
  }
  const floor = addDays(today, -RECURRING_MAX_BACKFILL_DAYS - 1);
  const after = last !== null && last > floor ? last : floor;
  return { lastGeneratedOn: last, nextDueOn: data.active ? nextOccurrence(data, after) : null };
}

/** How many more budgets / rules each group may add, for the ones created or restored in this push. */
async function roomLeft(db: Db, todo: Mutation[], known: Map<string, Known>) {
  // A new row takes a place, and so does a restored one (which is back among the group's rows).
  const creating = (entity: 'budget' | 'recurring') =>
    unique(
      todo.flatMap((m) => {
        if (m.entity !== entity) return [];
        if (m.op === 'restore') return [m.groupId];
        return m.op === 'upsert' && !known.has(key(entity, m.data.id)) ? [m.data.groupId] : [];
      }),
    );
  const [budgetGroups, ruleGroups] = [creating('budget'), creating('recurring')];

  const used = new Map<string, number>();
  if (budgetGroups.length > 0) {
    const rows = await db
      .select({ groupId: budgets.groupId, n: count() })
      .from(budgets)
      .where(and(inArray(budgets.groupId, budgetGroups), isNull(budgets.deletedAt)))
      .groupBy(budgets.groupId);
    for (const row of rows) used.set(`budget:${row.groupId}`, row.n);
  }
  if (ruleGroups.length > 0) {
    const rows = await db
      .select({ groupId: recurringRules.groupId, n: count() })
      .from(recurringRules)
      .where(and(inArray(recurringRules.groupId, ruleGroups), isNull(recurringRules.deletedAt)))
      .groupBy(recurringRules.groupId);
    for (const row of rows) used.set(`recurring:${row.groupId}`, row.n);
  }

  return {
    /** Takes one place for a new row; false when the group is full. Other entities are unlimited. */
    take(entity: EntityName, groupId: string): boolean {
      if (entity !== 'budget' && entity !== 'recurring') return true;
      const cap = entity === 'budget' ? MAX_BUDGETS_PER_GROUP : MAX_RECURRING_PER_GROUP;
      const k = `${entity}:${groupId}`;
      const n = used.get(k) ?? 0;
      if (n >= cap) return false;
      used.set(k, n + 1);
      return true;
    },
    /** Gives a place back when a row is deleted, so the cap is checked against what the push leaves. */
    release(entity: EntityName, groupId: string): void {
      if (entity !== 'budget' && entity !== 'recurring') return;
      const k = `${entity}:${groupId}`;
      used.set(k, Math.max(0, (used.get(k) ?? 0) - 1));
    },
  };
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
  if (write.kind === 'upsert') return upsertStatement(db, write, userId, now, seq);

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
    case 'budget':
      return db
        .update(budgets)
        .set({ ...set, version: sql`${budgets.version} + 1` })
        .where(
          and(
            eq(budgets.id, id),
            eq(budgets.groupId, groupId),
            wantDeleted ? isNull(budgets.deletedAt) : sql`${budgets.deletedAt} IS NOT NULL`,
          ),
        );
    case 'recurring':
      return db
        .update(recurringRules)
        .set({
          ...set,
          // Deleted: nothing due. Restored: starts again from today (`recurringTombstoneSchedule`).
          ...(write.schedule
            ? {
                nextDueOn: write.schedule.nextDueOn,
                ...(wantDeleted ? {} : { lastGeneratedOn: write.schedule.lastGeneratedOn }),
              }
            : {}),
          version: sql`${recurringRules.version} + 1`,
        })
        .where(
          and(
            eq(recurringRules.id, id),
            eq(recurringRules.groupId, groupId),
            wantDeleted
              ? isNull(recurringRules.deletedAt)
              : sql`${recurringRules.deletedAt} IS NOT NULL`,
          ),
        );
  }
}

/**
 * Insert-or-update. Last writer wins, but never over a tombstone and never across groups
 * (the `WHERE` on the update), so a concurrent delete or a forged group id changes nothing.
 */
function upsertStatement(
  db: Db,
  write: Extract<Write, { kind: 'upsert' }>,
  userId: string,
  now: number,
  seq: Seq,
): Statement {
  const m = write.mutation;
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
    case 'budget': {
      const { data } = m;
      const fields = { categoryId: data.categoryId, amountMinor: data.amountMinor };
      return db
        .insert(budgets)
        .values({
          id: data.id,
          groupId: data.groupId,
          ...fields,
          version: 1,
          deletedAt: null,
          ...sync,
        })
        .onConflictDoUpdate({
          target: budgets.id,
          set: { ...fields, ...sync, version: sql`${budgets.version} + 1` },
          setWhere: and(isNull(budgets.deletedAt), eq(budgets.groupId, data.groupId)),
        });
    }
    case 'recurring': {
      const { data } = m;
      const fields = {
        frequency: data.frequency,
        startOn: data.startOn,
        endOn: data.endOn,
        active: data.active,
        amountMinor: data.amountMinor,
        categoryId: data.categoryId,
        note: data.note,
        splitType: data.splitType,
        payers: data.payers,
        shares: data.shares,
      };
      const { createdBy, lastGeneratedOn, nextDueOn, resumed, tookOver } =
        write.server as RecurringServer;
      return db
        .insert(recurringRules)
        .values({
          id: data.id,
          groupId: data.groupId,
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
          setWhere: and(isNull(recurringRules.deletedAt), eq(recurringRules.groupId, data.groupId)),
        });
    }
  }
}
