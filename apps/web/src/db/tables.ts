import type { EntityName } from '@budget/shared';
import type { Table } from 'dexie';
import type { BudgetDb } from './database';
import type { SyncedRow } from './types';

/**
 * The one place that says which local table holds which kind of synced row. It is a `Record`
 * over every entity name, so adding a fourth synced entity is a compile error here until it is
 * mapped, rather than a silent gap in the sync code.
 */
export function entityTables(db: BudgetDb): Record<EntityName, Table<SyncedRow, string>> {
  return {
    category: db.categories as unknown as Table<SyncedRow, string>,
    expense: db.expenses as unknown as Table<SyncedRow, string>,
    settlement: db.settlements as unknown as Table<SyncedRow, string>,
  };
}

export const tableFor = (db: BudgetDb, entity: EntityName): Table<SyncedRow, string> =>
  entityTables(db)[entity];
