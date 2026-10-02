import type {
  BudgetData,
  CategoryData,
  EntityName,
  ExpenseData,
  RecurringData,
  SettlementData,
} from '@budget/shared';
import { uuidv7 } from '@budget/shared';
import type { BudgetDb } from './database';
import { tableFor } from './tables';
import { entityKey, type OutboxEntry, type SyncedRow } from './types';

/**
 * Every write from the UI goes through here: it changes the local row and queues the change in
 * the outbox in ONE transaction, so the screen updates instantly and nothing can be lost
 * between "saved" and "queued". The sync engine sends the outbox when it can. Entering an
 * expense therefore never depends on the network.
 */

type Listener = () => void;
const listeners = new Set<Listener>();

/** The sync engine subscribes to learn that there is something new to send. */
export function onLocalWrite(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const announce = () => {
  for (const listener of listeners) listener();
};

/**
 * The version a new change builds on. Several edits can queue up before a sync, and each must
 * build on the one before it, or the server would call the later ones stale.
 */
async function baseVersionFor(
  db: BudgetDb,
  entity: EntityName,
  id: string,
  existing: SyncedRow | undefined,
): Promise<number | null> {
  const pending = await db.outbox.where('entityKey').equals(entityKey(entity, id)).sortBy('seq');
  const last = pending.at(-1);
  if (last) return last.baseVersion === null ? null : last.baseVersion + 1;
  return existing && existing.version > 0 ? existing.version : null;
}

async function queue(
  db: BudgetDb,
  entry: Omit<OutboxEntry, 'mutationId' | 'entityKey' | 'createdAt'>,
  now: number,
): Promise<void> {
  await db.outbox.add({
    ...entry,
    mutationId: uuidv7(now),
    entityKey: entityKey(entry.entity, entry.entityId),
    createdAt: now,
  });
}

async function upsert<T extends { id: string; groupId: string }>(
  db: BudgetDb,
  entity: EntityName,
  data: T,
  build: (existing: SyncedRow | undefined) => SyncedRow & Record<string, unknown>,
): Promise<void> {
  const table = tableFor(db, entity);
  const now = Date.now();
  await db.transaction('rw', [table, db.outbox], async () => {
    const existing = await table.get(data.id);
    const baseVersion = await baseVersionFor(db, entity, data.id, existing);
    await table.put(build(existing));
    await queue(
      db,
      {
        entity,
        entityId: data.id,
        groupId: data.groupId,
        op: 'upsert',
        baseVersion,
        data: data as unknown as OutboxEntry['data'],
      },
      now,
    );
  });
  announce();
}

const meta = (existing: SyncedRow | undefined, me: string, now: number) => ({
  version: existing?.version ?? 0,
  serverSeq: existing?.serverSeq ?? 0,
  updatedAt: now,
  updatedBy: me,
  deletedAt: null,
});

export function saveExpense(db: BudgetDb, me: string, data: ExpenseData): Promise<void> {
  return upsert(db, 'expense', data, (existing) => ({
    ...data,
    createdBy: (existing as unknown as { createdBy?: string } | undefined)?.createdBy ?? me,
    ...meta(existing, me, Date.now()),
  }));
}

export function saveCategory(db: BudgetDb, me: string, data: CategoryData): Promise<void> {
  return upsert(db, 'category', data, (existing) => ({
    ...data,
    ...meta(existing, me, Date.now()),
  }));
}

export function saveSettlement(db: BudgetDb, me: string, data: SettlementData): Promise<void> {
  return upsert(db, 'settlement', data, (existing) => ({
    ...data,
    createdBy: (existing as unknown as { createdBy?: string } | undefined)?.createdBy ?? me,
    ...meta(existing, me, Date.now()),
  }));
}

export function saveBudget(db: BudgetDb, me: string, data: BudgetData): Promise<void> {
  return upsert(db, 'budget', data, (existing) => ({
    ...data,
    ...meta(existing, me, Date.now()),
  }));
}

/**
 * `lastGeneratedOn` is the server's to move (it creates the expenses), so an edit keeps whatever
 * this device last heard; the next pull brings the real value.
 */
export function saveRecurring(db: BudgetDb, me: string, data: RecurringData): Promise<void> {
  return upsert(db, 'recurring', data, (existing) => {
    const known = existing as unknown as
      | { createdBy?: string; lastGeneratedOn?: string | null }
      | undefined;
    return {
      ...data,
      createdBy: known?.createdBy ?? me,
      lastGeneratedOn: known?.lastGeneratedOn ?? null,
      ...meta(existing, me, Date.now()),
    };
  });
}

/** Deletes (tombstones) or restores a row. A tombstone is kept so the delete reaches the server. */
async function setDeleted(
  db: BudgetDb,
  entity: EntityName,
  id: string,
  me: string,
  deleted: boolean,
): Promise<void> {
  const table = tableFor(db, entity);
  const now = Date.now();
  await db.transaction('rw', [table, db.outbox], async () => {
    const existing = await table.get(id);
    if (!existing) return;
    const baseVersion = await baseVersionFor(db, entity, id, existing);
    await table.update(id, { deletedAt: deleted ? now : null, updatedAt: now, updatedBy: me });
    await queue(
      db,
      {
        entity,
        entityId: id,
        groupId: existing.groupId,
        op: deleted ? 'delete' : 'restore',
        baseVersion,
      },
      now,
    );
  });
  announce();
}

export const deleteExpense = (db: BudgetDb, me: string, id: string) =>
  setDeleted(db, 'expense', id, me, true);
export const restoreExpense = (db: BudgetDb, me: string, id: string) =>
  setDeleted(db, 'expense', id, me, false);
export const deleteCategory = (db: BudgetDb, me: string, id: string) =>
  setDeleted(db, 'category', id, me, true);
export const deleteSettlement = (db: BudgetDb, me: string, id: string) =>
  setDeleted(db, 'settlement', id, me, true);
export const restoreSettlement = (db: BudgetDb, me: string, id: string) =>
  setDeleted(db, 'settlement', id, me, false);
export const deleteBudget = (db: BudgetDb, me: string, id: string) =>
  setDeleted(db, 'budget', id, me, true);
export const restoreBudget = (db: BudgetDb, me: string, id: string) =>
  setDeleted(db, 'budget', id, me, false);
export const deleteRecurring = (db: BudgetDb, me: string, id: string) =>
  setDeleted(db, 'recurring', id, me, true);
export const restoreRecurring = (db: BudgetDb, me: string, id: string) =>
  setDeleted(db, 'recurring', id, me, false);
