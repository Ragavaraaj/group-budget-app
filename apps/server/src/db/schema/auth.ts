import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { users } from './users';

/**
 * One row per Google sign-in in progress. Keeping the state and PKCE verifier here, not only in a
 * cookie, means the callback still works when iOS finishes sign-in in a different browser than the
 * installed app that started it (docs/auth.md, "attempt-login").
 */
export const oauthStates = sqliteTable(
  'oauth_states',
  {
    stateHash: text('state_hash').primaryKey(), // SHA-256 of the `state` sent to Google
    codeVerifier: text('code_verifier').notNull(),
    /** SHA-256 of the installed app's secret, when it started this sign-in. */
    attemptHash: text('attempt_hash'),
    /** The group invite the person arrived with, if any. */
    inviteToken: text('invite_token'),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [index('oauth_states_expires_idx').on(table.expiresAt)],
);

/** Hands a sign-in completed in the browser back to the installed app. See docs/auth.md. */
export const loginAttempts = sqliteTable(
  'login_attempts',
  {
    idHash: text('id_hash').primaryKey(), // SHA-256 of the installed app's secret
    /** Who signed in; set by the callback, usable only after confirmation. */
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the token on the confirmation page. */
    confirmHash: text('confirm_hash').unique(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    confirmedAt: integer('confirmed_at'),
    consumedAt: integer('consumed_at'),
  },
  (table) => [index('login_attempts_expires_idx').on(table.expiresAt)],
);
