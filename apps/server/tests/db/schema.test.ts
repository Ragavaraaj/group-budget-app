import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/client';
import { sessions, users } from '../../src/db/schema';

const db = createDb(env.DB);
const now = new Date('2026-10-02T00:00:00Z');

const user = (id: string, googleSub: string) => ({
  id,
  googleSub,
  email: `${id}@example.com`,
  displayName: id,
  createdAt: now,
  lastLoginAt: now,
});

const session = (userId: string) => ({ idHash: 'hash', userId, expiresAt: now, createdAt: now });

/** Drizzle wraps driver errors; the SQLite message (UNIQUE, FOREIGN KEY, ...) is on `cause`. */
async function failureText(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return `${error} ${(error as { cause?: unknown }).cause ?? ''}`;
  }
  return 'did not fail';
}

beforeEach(async () => {
  await db.delete(users); // sessions cascade
});

describe('initial migration', () => {
  it('creates the users and sessions tables', async () => {
    const rows = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{
      name: string;
    }>();
    expect(rows.results.map((row) => row.name)).toEqual(
      expect.arrayContaining(['users', 'sessions']),
    );
  });

  it('enforces one account per Google sub', async () => {
    await db.insert(users).values(user('u1', 'google-sub-1'));
    expect(await failureText(db.insert(users).values(user('u2', 'google-sub-1')))).toMatch(
      /UNIQUE/,
    );
  });

  it('enforces foreign keys and cascades session deletion with the user', async () => {
    expect(await failureText(db.insert(sessions).values(session('missing-user')))).toMatch(
      /FOREIGN KEY/,
    );

    await db.insert(users).values(user('u1', 'google-sub-1'));
    await db.insert(sessions).values(session('u1'));
    await db.delete(users);
    expect(await db.select().from(sessions)).toEqual([]);
  });

  it('commits a batch atomically: if one statement fails, none are applied', async () => {
    await db.insert(users).values(user('u1', 'google-sub-1'));

    const failure = failureText(
      db.batch([
        db.insert(users).values(user('u2', 'google-sub-2')),
        db.insert(users).values(user('u3', 'google-sub-1')), // violates UNIQUE
      ]),
    );
    expect(await failure).toMatch(/UNIQUE/);

    const ids = (await db.select({ id: users.id }).from(users)).map((row) => row.id);
    expect(ids).toEqual(['u1']);
  });
});
