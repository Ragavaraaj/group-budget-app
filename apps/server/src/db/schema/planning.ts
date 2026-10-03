import type { Allocation } from '@budget/shared';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { groups } from './groups';
import { syncColumns } from './sync';
import { users } from './users';

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
