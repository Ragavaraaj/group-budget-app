import type { Allocation } from '@budget/shared';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { groups } from './groups';
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
const syncColumns = {
  version: integer('version').notNull().default(1),
  updatedAt: integer('updated_at').notNull(),
  updatedBy: text('updated_by')
    .notNull()
    .references(() => users.id),
  deletedAt: integer('deleted_at'),
  serverSeq: integer('server_seq').notNull(),
};

export const categories = sqliteTable(
  'categories',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id),
    name: text('name').notNull(),
    icon: text('icon').notNull(),
    color: text('color').notNull(),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    ...syncColumns,
  },
  (table) => [index('categories_group_seq_idx').on(table.groupId, table.serverSeq)],
);

export const expenses = sqliteTable(
  'expenses',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id),
    /** A plain local "YYYY-MM-DD" date, never a UTC instant. */
    occurredOn: text('occurred_on').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    categoryId: text('category_id'),
    note: text('note').notNull().default(''),
    splitType: text('split_type', { enum: ['equal', 'exact', 'percent', 'shares'] }).notNull(),
    /** Who paid and who owes, as JSON on the row so an expense changes atomically with its split. */
    payers: text('payers', { mode: 'json' }).$type<Allocation[]>().notNull(),
    shares: text('shares', { mode: 'json' })
      .$type<(Allocation & { weight?: number })[]>()
      .notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    ...syncColumns,
  },
  (table) => [
    index('expenses_group_seq_idx').on(table.groupId, table.serverSeq),
    index('expenses_group_date_idx').on(table.groupId, table.occurredOn),
  ],
);

export const settlements = sqliteTable(
  'settlements',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id),
    fromUser: text('from_user')
      .notNull()
      .references(() => users.id),
    toUser: text('to_user')
      .notNull()
      .references(() => users.id),
    amountMinor: integer('amount_minor').notNull(),
    occurredOn: text('occurred_on').notNull(),
    note: text('note').notNull().default(''),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    ...syncColumns,
  },
  (table) => [index('settlements_group_seq_idx').on(table.groupId, table.serverSeq)],
);

/** A monthly spending limit for a group; `categoryId` null is the overall one. */
export const budgets = sqliteTable(
  'budgets',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id),
    categoryId: text('category_id'),
    amountMinor: integer('amount_minor').notNull(),
    ...syncColumns,
  },
  (table) => [index('budgets_group_seq_idx').on(table.groupId, table.serverSeq)],
);

/**
 * An expense that repeats. The columns up to `shares` are the template; `lastGeneratedOn` and
 * `nextDueOn` belong to the scheduled job, not to clients. `nextDueOn` is null when nothing more
 * is due (paused, or past its end date), and the job finds work through its index.
 */
export const recurringRules = sqliteTable(
  'recurring_rules',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id),
    frequency: text('frequency', { enum: ['weekly', 'monthly', 'yearly'] }).notNull(),
    startOn: text('start_on').notNull(),
    endOn: text('end_on'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    amountMinor: integer('amount_minor').notNull(),
    categoryId: text('category_id'),
    note: text('note').notNull().default(''),
    splitType: text('split_type', { enum: ['equal', 'exact', 'percent', 'shares'] }).notNull(),
    payers: text('payers', { mode: 'json' }).$type<Allocation[]>().notNull(),
    shares: text('shares', { mode: 'json' })
      .$type<(Allocation & { weight?: number })[]>()
      .notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    lastGeneratedOn: text('last_generated_on'),
    nextDueOn: text('next_due_on'),
    ...syncColumns,
  },
  (table) => [
    index('recurring_group_seq_idx').on(table.groupId, table.serverSeq),
    index('recurring_due_idx').on(table.nextDueOn),
  ],
);

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
