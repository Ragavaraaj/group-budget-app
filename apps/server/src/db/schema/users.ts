import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' });

export const users = sqliteTable('users', {
  id: text('id').primaryKey(), // UUIDv7
  googleSub: text('google_sub').notNull().unique(), // Google's stable account id; never key on email
  email: text('email').notNull(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at').notNull(),
  lastLoginAt: timestamp('last_login_at').notNull(),
  /** Added by a group owner by name only: has no Google account and can never sign in. */
  isPlaceholder: integer('is_placeholder', { mode: 'boolean' }).notNull().default(false),
});

export const sessions = sqliteTable(
  'sessions',
  {
    idHash: text('id_hash').primaryKey(), // SHA-256 of the cookie token; the token itself is never stored
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at').notNull(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at').notNull(),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)],
);
