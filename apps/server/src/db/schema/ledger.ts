import type { Allocation } from '@budget/shared';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { groups } from './groups';
import { syncColumns } from './sync';
import { users } from './users';

/** The synced rows of a group's books: categories, expenses and payments between people. */

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
