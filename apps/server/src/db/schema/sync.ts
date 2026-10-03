import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { users } from './users';

/** Single row (id = 1): the last `server_seq` handed out. Seeded by a migration. */
export const syncCounter = sqliteTable('sync_counter', {
  id: integer('id').primaryKey(),
  value: integer('value').notNull(),
});

/**
 * Columns every synced row has. `version` counts applied changes, `deletedAt` is the tombstone
 * (rows are never hard-deleted), and `serverSeq` is the pull cursor.
 */
export const syncColumns = {
  version: integer('version').notNull().default(1),
  updatedAt: integer('updated_at').notNull(),
  updatedBy: text('updated_by')
    .notNull()
    .references(() => users.id),
  deletedAt: integer('deleted_at'),
  serverSeq: integer('server_seq').notNull(),
};

/** One row per applied mutation. The primary key is what makes a retried push idempotent. */
export const processedMutations = sqliteTable('processed_mutations', {
  mutationId: text('mutation_id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  appliedAt: integer('applied_at').notNull(),
});

/** Append-only record of every applied change, for diagnosing and undoing bad merges. */
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    mutationId: text('mutation_id').notNull(),
    userId: text('user_id').notNull(),
    groupId: text('group_id').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    before: text('before', { mode: 'json' }),
    after: text('after', { mode: 'json' }),
    at: integer('at').notNull(),
  },
  (table) => [index('audit_log_group_at_idx').on(table.groupId, table.at)],
);
