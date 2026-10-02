import { describe, expect, it } from 'vitest';
import { createTestApp } from '../test/helpers';
import { sessions, users } from './schema';

const now = new Date('2026-10-02T00:00:00Z');
const user = (id: string, googleSub: string) => ({
  id,
  googleSub,
  email: `${id}@example.com`,
  displayName: id,
  createdAt: now,
  lastLoginAt: now,
});

describe('initial migration', () => {
  it('creates the users and sessions tables', () => {
    const { sqlite } = createTestApp();
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '%drizzle%'")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toEqual(expect.arrayContaining(['users', 'sessions']));
  });

  it('enforces one account per Google sub', () => {
    const { db } = createTestApp();
    db.insert(users).values(user('u1', 'google-sub-1')).run();
    expect(() => db.insert(users).values(user('u2', 'google-sub-1')).run()).toThrow(/UNIQUE/);
  });

  it('enforces foreign keys and cascades session deletion with the user', () => {
    const { db } = createTestApp();
    const session = (userId: string) => ({
      idHash: 'hash',
      userId,
      expiresAt: now,
      createdAt: now,
    });

    expect(() => db.insert(sessions).values(session('missing-user')).run()).toThrow(/FOREIGN KEY/);

    db.insert(users).values(user('u1', 'google-sub-1')).run();
    db.insert(sessions).values(session('u1')).run();
    db.delete(users).run();
    expect(db.select().from(sessions).all()).toEqual([]);
  });
});
