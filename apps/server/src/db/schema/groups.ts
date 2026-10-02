import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { users } from './users';

// Timestamps in the synced tables are plain epoch-millisecond integers (not Drizzle's Date
// mode): they travel to the clients as numbers, so there is nothing to convert.

/** A group of people sharing expenses. A personal ledger is a group with one member. */
export const groups = sqliteTable('groups', {
  id: text('id').primaryKey(), // UUIDv7
  name: text('name').notNull(),
  isPersonal: integer('is_personal', { mode: 'boolean' }).notNull().default(false),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: integer('created_at').notNull(),
  version: integer('version').notNull().default(1),
  serverSeq: integer('server_seq').notNull(),
});

export const memberships = sqliteTable(
  'memberships',
  {
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role', { enum: ['owner', 'member'] }).notNull(),
    joinedAt: integer('joined_at').notNull(),
    /** Set when the person left or was removed. Kept so the change reaches their devices. */
    removedAt: integer('removed_at'),
    serverSeq: integer('server_seq').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.userId] }),
    index('memberships_group_seq_idx').on(table.groupId, table.serverSeq),
    index('memberships_user_seq_idx').on(table.userId, table.serverSeq),
  ],
);

export const invites = sqliteTable(
  'invites',
  {
    id: text('id').primaryKey(),
    /** SHA-256 of the invite token. The token itself is shown once and never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    maxUses: integer('max_uses').notNull(),
    usedCount: integer('used_count').notNull().default(0),
    revokedAt: integer('revoked_at'),
  },
  (table) => [index('invites_group_idx').on(table.groupId)],
);
