import Dexie, { type Table } from 'dexie';
import type {
  LocalBudget,
  LocalCategory,
  LocalExpense,
  LocalGroup,
  LocalMember,
  LocalRecurring,
  LocalSettlement,
  MetaRow,
  OutboxEntry,
} from './types';

/**
 * One IndexedDB database per signed-in person, so two accounts on one device never see each
 * other's data (docs/sync.md). The UI reads only from here; the sync engine keeps it in step
 * with the server.
 */
export class BudgetDb extends Dexie {
  groups!: Table<LocalGroup, string>;
  members!: Table<LocalMember, [string, string]>;
  categories!: Table<LocalCategory, string>;
  expenses!: Table<LocalExpense, string>;
  settlements!: Table<LocalSettlement, string>;
  budgets!: Table<LocalBudget, string>;
  recurring!: Table<LocalRecurring, string>;
  outbox!: Table<OutboxEntry, number>;
  meta!: Table<MetaRow, string>;

  constructor(readonly userId: string) {
    super(`budget-${userId}`);
    this.version(1).stores({
      groups: 'id',
      members: '[groupId+userId], groupId, userId',
      categories: 'id, groupId',
      expenses: 'id, groupId, [groupId+occurredOn]',
      settlements: 'id, groupId',
      outbox: '++seq, mutationId, entityKey',
      meta: 'key',
    });
    // Budgets and recurring rules came later; adding tables leaves existing data as it is.
    this.version(2).stores({
      budgets: 'id, groupId',
      recurring: 'id, groupId',
    });
  }
}

const open = new Map<string, BudgetDb>();

/** The (single) open database for this person. */
export function getDb(userId: string): BudgetDb {
  let db = open.get(userId);
  if (!db) {
    db = new BudgetDb(userId);
    open.set(userId, db);
  }
  return db;
}

/** Closes and deletes this person's local data (used by logout). */
export async function wipeDb(userId: string): Promise<void> {
  const db = open.get(userId) ?? new BudgetDb(userId);
  open.delete(userId);
  db.close();
  await Dexie.delete(db.name);
}

// --- small typed helpers over the key/value `meta` table ---------------------------------------

export async function getMeta<T>(db: BudgetDb, key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}

export async function setMeta(db: BudgetDb, key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}
