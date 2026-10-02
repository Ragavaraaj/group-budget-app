import { ENTITY_NAMES, type EntityName, type PullResponse } from '@budget/shared';
import type { Table } from 'dexie';
import { type BudgetDb, getMeta, setMeta } from './database';
import { entityTables } from './tables';
import { entityKey, type SyncedRow } from './types';

export interface ApplyOptions {
  me: string;
  /** The `since` the page was requested with. */
  since: number;
  /** False for a one-group backfill, which must not move the global cursor. */
  updateCursor: boolean;
}

export interface ApplyResult {
  /** How many rows changed locally. */
  applied: number;
  /** Names of groups this person was removed from (their data is gone from this device). */
  removedFrom: string[];
}

export const BACKFILL_PREFIX = 'backfill:';

/** Deletes everything this device holds about a group. */
export async function purgeGroup(db: BudgetDb, groupId: string): Promise<void> {
  await Promise.all([
    db.groups.delete(groupId),
    db.members.where('groupId').equals(groupId).delete(),
    db.categories.where('groupId').equals(groupId).delete(),
    db.expenses.where('groupId').equals(groupId).delete(),
    db.settlements.where('groupId').equals(groupId).delete(),
  ]);
  const queued = await db.outbox.toArray();
  const stale = queued.filter((entry) => entry.groupId === groupId).map((entry) => entry.seq);
  await db.outbox.bulkDelete(stale.filter((seq): seq is number => seq !== undefined));
}

/**
 * Stores a page of server changes. Rows this device has unsent edits for are left alone (the
 * edit will be sent, and the server's version comes back afterwards), and a row is never
 * replaced by an older one.
 */
export function applyPull(
  db: BudgetDb,
  response: PullResponse,
  options: ApplyOptions,
): Promise<ApplyResult> {
  const tables = [
    db.groups,
    db.members,
    db.categories,
    db.expenses,
    db.settlements,
    db.outbox,
    db.meta,
  ];
  return db.transaction('rw', tables, async () => {
    const pending = new Set(await db.outbox.orderBy('entityKey').uniqueKeys());

    // 1. Groups this person was removed from: drop their data and ignore the group's rows.
    const removed = new Set<string>();
    const removedFrom: string[] = [];
    for (const member of response.members) {
      if (member.userId !== options.me || member.removedAt === null) continue;
      removed.add(member.groupId);
      const name = (await db.groups.get(member.groupId))?.name;
      if (name) removedFrom.push(name);
      await purgeGroup(db, member.groupId);
    }

    // 2. A group joined after the first sync has history older than our cursor: queue a backfill.
    if (options.updateCursor && options.since > 0) {
      const known = new Set(await db.groups.toCollection().primaryKeys());
      for (const member of response.members) {
        const isNew = member.userId === options.me && member.removedAt === null;
        if (isNew && !known.has(member.groupId) && !removed.has(member.groupId)) {
          const key = `${BACKFILL_PREFIX}${member.groupId}`;
          if ((await getMeta<number>(db, key)) === undefined) await setMeta(db, key, 0);
        }
      }
    }

    let applied = 0;
    const put = async <T extends { serverSeq: number }>(
      table: Table<T, string>,
      rows: T[],
      idOf: (row: T) => string,
      skip: (row: T) => boolean = () => false,
    ) => {
      const incoming = rows.filter((row) => !skip(row));
      const existing = await table.bulkGet(incoming.map(idOf));
      const fresh = incoming.filter((row, i) => (existing[i]?.serverSeq ?? -1) <= row.serverSeq);
      await table.bulkPut(fresh);
      applied += fresh.length;
    };

    await put(
      db.groups,
      response.groups.filter((g) => !removed.has(g.id)),
      (g) => g.id,
    );
    await (async () => {
      const members = response.members.filter((m) => !removed.has(m.groupId));
      const existing = await db.members.bulkGet(members.map((m) => [m.groupId, m.userId]));
      const fresh = members.filter((m, i) => (existing[i]?.serverSeq ?? -1) <= m.serverSeq);
      await db.members.bulkPut(fresh);
      applied += fresh.length;
    })();

    // The synced entities all behave the same way; the table map is the only per-entity detail.
    const tables = entityTables(db);
    const incoming: Record<EntityName, SyncedRow[]> = {
      category: response.categories,
      expense: response.expenses,
      settlement: response.settlements,
    };
    for (const entity of ENTITY_NAMES) {
      await put(
        tables[entity],
        incoming[entity],
        (row) => row.id,
        (row) => removed.has(row.groupId) || pending.has(entityKey(entity, row.id)),
      );
    }

    if (options.updateCursor) {
      const current = (await getMeta<number>(db, 'cursor')) ?? 0;
      await setMeta(db, 'cursor', Math.max(current, response.cursor));
    }
    return { applied, removedFrom };
  });
}
