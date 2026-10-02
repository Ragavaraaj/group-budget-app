import { env } from 'cloudflare:workers';
import { uuidv7 } from '@budget/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from '../../../test/helpers';
import {
  categoriesOf,
  createSharedGroup,
  expenseData,
  join,
  makeInvite,
  type Person,
  pull,
  pullAll,
  push,
  signedIn,
  tombstone,
  upsert,
} from '../../../test/sync-helpers';
import { createDb } from '../../db/client';
import { pullChanges } from './pull';

let alice: Person;
let bob: Person;

beforeEach(async () => {
  await resetDb();
  alice = await signedIn('alice@example.com', 'Alice');
  bob = await signedIn('bob@example.com', 'Bob');
});

const addExpenses = async (
  person: Person,
  groupId: string,
  n: number,
  categoryId: string | null = null,
) => {
  for (let start = 0; start < n; start += 10) {
    const batch = Array.from({ length: Math.min(10, n - start) }, (_, i) =>
      upsert('expense', expenseData(groupId, person.id, { note: `e${start + i}`, categoryId })),
    );
    await push(person, batch);
  }
};

describe('pull', () => {
  it('requires a session', async () => {
    const { Client } = await import('../../../test/helpers');
    expect((await new Client().get('/api/sync/pull')).status).toBe(401);
  });

  it('gives a new account its personal group, itself as a member, and default categories', async () => {
    const { body } = await pull(alice);
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0]).toMatchObject({
      id: alice.personalGroupId,
      isPersonal: true,
      createdBy: alice.id,
    });
    expect(body.members).toEqual([
      expect.objectContaining({
        groupId: alice.personalGroupId,
        userId: alice.id,
        role: 'owner',
        displayName: 'Alice',
        removedAt: null,
      }),
    ]);
    expect(body.categories).toHaveLength(10);
    expect(body.expenses).toEqual([]);
    expect(body.hasMore).toBe(false);
  });

  it('shows only your own groups', async () => {
    await addExpenses(bob, bob.personalGroupId, 2);
    const aliceSees = await pullAll(alice);
    expect(aliceSees.expenses).toEqual([]);
    expect(aliceSees.groups.map((g) => g.id)).toEqual([alice.personalGroupId]);
  });

  it('leaves the cursor alone when nothing changed, and returns only newer changes after it', async () => {
    const first = await pull(alice);
    const quiet = await pull(alice, { since: first.body.cursor });
    expect(quiet.body).toMatchObject({
      cursor: first.body.cursor,
      hasMore: false,
      expenses: [],
      categories: [],
    });

    await addExpenses(alice, alice.personalGroupId, 1);
    const next = await pull(alice, { since: first.body.cursor });
    expect(next.body.expenses).toHaveLength(1);
    expect(next.body.cursor).toBeGreaterThan(first.body.cursor);
  });

  it('delivers deletes as tombstones', async () => {
    const data = expenseData(alice.personalGroupId, alice.id);
    await push(alice, [upsert('expense', data)]);
    const cursor = (await pull(alice)).body.cursor;
    await push(alice, [tombstone('delete', 'expense', data.id, alice.personalGroupId, 1)]);

    const { body } = await pull(alice, { since: cursor });
    expect(body.expenses).toHaveLength(1);
    expect(body.expenses[0]).toMatchObject({ id: data.id, version: 2 });
    expect(body.expenses[0]?.deletedAt).toBeGreaterThan(0);
  });

  it('pages through a large history exactly once per row, in order', async () => {
    const category = (await categoriesOf(alice, alice.personalGroupId))[0]?.id ?? null;
    await addExpenses(alice, alice.personalGroupId, 37, category);

    const all = await pullAll(alice, 0, 8);
    expect(all.pages).toBeGreaterThan(4);
    expect(all.expenses).toHaveLength(37);
    expect(new Set(all.expenses.map((e) => e.id)).size).toBe(37);
    expect(all.categories).toHaveLength(10);
    expect(all.groups).toHaveLength(1);
    const seqs = all.expenses.map((e) => e.serverSeq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });

  it('pages correctly when several tables have different amounts of data', async () => {
    const shared = await createSharedGroup(alice);
    await join(bob, (await makeInvite(alice, shared)).token);
    await addExpenses(alice, alice.personalGroupId, 12);
    await addExpenses(alice, shared, 5);
    const all = await pullAll(alice, 0, 4);
    expect(all.expenses).toHaveLength(17);
    expect(all.groups).toHaveLength(2);
    expect(all.categories).toHaveLength(20);
    expect(all.members).toHaveLength(3); // alice (personal), alice + bob (shared)
  });

  it('rejects out-of-range paging parameters', async () => {
    expect((await alice.client.get('/api/sync/pull?limit=0')).status).toBe(400);
    expect((await alice.client.get('/api/sync/pull?limit=500')).status).toBe(400);
    expect((await alice.client.get('/api/sync/pull?since=-1')).status).toBe(400);
    expect((await alice.client.get('/api/sync/pull?groupId=nope')).status).toBe(400);
  });
});

describe('pull: shared groups', () => {
  it("lets a new member fetch the group's whole history, which the global cursor would skip", async () => {
    const shared = await createSharedGroup(alice);
    await addExpenses(alice, shared, 6);

    // Bob is fully caught up, and his cursor is already past the group's history, before he joins.
    await addExpenses(bob, bob.personalGroupId, 1);
    const cursor = (await pullAll(bob)).cursor;
    await join(bob, (await makeInvite(alice, shared)).token);

    const incremental = await pullAll(bob, cursor);
    expect(incremental.members.some((m) => m.groupId === shared && m.userId === bob.id)).toBe(true);
    expect(incremental.expenses).toHaveLength(0); // the history is older than his cursor

    const backfill = await pullAll(bob, 0, 100, shared);
    expect(backfill.expenses).toHaveLength(6);
    expect(backfill.groups.map((g) => g.id)).toEqual([shared]);
    expect(backfill.categories).toHaveLength(10);
    expect(backfill.members.map((m) => m.displayName).sort()).toEqual(['Alice', 'Bob']);
  });

  it('refuses a backfill for a group you are not in', async () => {
    const shared = await createSharedGroup(alice);
    expect((await pull(bob, { groupId: shared })).status).toBe(403);
    expect((await pull(bob, { groupId: uuidv7() })).status).toBe(403);
  });

  it('shows a member the other members, with the names they signed in with', async () => {
    const shared = await createSharedGroup(alice);
    await join(bob, (await makeInvite(alice, shared)).token);
    const { members } = await pullAll(bob);
    const inShared = members.filter((m) => m.groupId === shared);
    expect(inShared.map((m) => [m.displayName, m.role]).sort()).toEqual([
      ['Alice', 'owner'],
      ['Bob', 'member'],
    ]);
  });

  it('lets one member see another member’s change to a shared expense', async () => {
    const shared = await createSharedGroup(alice);
    await join(bob, (await makeInvite(alice, shared)).token);
    await pullAll(bob);
    const cursor = (await pull(bob)).body.cursor;

    await push(alice, [
      upsert(
        'expense',
        expenseData(shared, alice.id, {
          shares: [
            { userId: alice.id, amountMinor: 5_000 },
            { userId: bob.id, amountMinor: 5_000 },
          ],
        }),
      ),
    ]);
    const { body } = await pull(bob, { since: cursor });
    expect(body.expenses).toHaveLength(1);
  });

  it('tells a removed member they were removed, and stops showing them the group', async () => {
    const shared = await createSharedGroup(alice);
    await join(bob, (await makeInvite(alice, shared)).token);
    await addExpenses(alice, shared, 2);
    const cursor = (await pull(bob)).body.cursor;

    await alice.client.request(`/api/groups/${shared}/members/${bob.id}`, { method: 'DELETE' });
    await addExpenses(alice, shared, 1);

    const { body } = await pull(bob, { since: cursor });
    const own = body.members.find((m) => m.groupId === shared && m.userId === bob.id);
    expect(own?.removedAt).toBeGreaterThan(0);
    expect(body.expenses).toEqual([]); // nothing from the group after removal
    expect((await pull(bob, { groupId: shared })).status).toBe(403);
  });

  it('passes a changed display name on to the people they share groups with', async () => {
    const shared = await createSharedGroup(alice);
    await join(bob, (await makeInvite(alice, shared)).token);
    const cursor = (await pull(alice)).body.cursor;

    await new (
      alice.client.constructor as typeof import('../../../test/helpers').Client
    )().signInAsDev('bob@example.com', 'Robert');
    const { body } = await pull(alice, { since: cursor });
    expect(
      body.members.filter((m) => m.userId === bob.id).every((m) => m.displayName === 'Robert'),
    ).toBe(true);
    expect(body.members.some((m) => m.userId === bob.id && m.groupId === shared)).toBe(true);
  });
});

// D1 bills (and rate-limits) by rows scanned, not rows returned. These tests count the rows
// each pull scans so a missing or unused index fails here instead of burning the daily quota.
describe('pull: rows scanned', () => {
  /** A D1 binding that adds up `meta.rows_read` of everything run through `batch`. */
  function counting() {
    let rowsRead = 0;
    const d1 = new Proxy(env.DB, {
      get(target, prop, receiver) {
        if (prop === 'batch') {
          return async (statements: D1PreparedStatement[]) => {
            const results = await target.batch(statements);
            for (const r of results) rowsRead += r.meta.rows_read ?? 0;
            return results;
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    return {
      db: createDb(d1 as D1Database),
      reads: () => rowsRead,
      reset: () => {
        rowsRead = 0;
      },
    };
  }

  async function seedBigAccount() {
    const shared = await createSharedGroup(alice);
    await addExpenses(alice, alice.personalGroupId, 300);
    await addExpenses(alice, shared, 300);
    // Other people's data in the same tables must not be scanned either.
    await addExpenses(bob, bob.personalGroupId, 300);
    return shared;
  }

  it('scans next to nothing for a poll with no news, however much data exists', async () => {
    await seedBigAccount();
    const cursor = (await pullAll(alice)).cursor;
    const { db, reads, reset } = counting();
    reset();
    const result = await pullChanges(db, alice.id, { since: cursor, limit: 100 });
    expect(result?.hasMore).toBe(false);
    expect(reads()).toBeLessThan(80); // a small constant: the membership lookups, no history
  });

  it('scans in proportion to what changed, not to the size of the history', async () => {
    await seedBigAccount();
    const cursor = (await pullAll(alice)).cursor;
    await addExpenses(alice, alice.personalGroupId, 3);
    const { db, reads, reset } = counting();
    reset();
    const result = await pullChanges(db, alice.id, { since: cursor, limit: 100 });
    expect(result?.expenses).toHaveLength(3);
    // Every synced table repeats the membership lookup, so the constant grows a little with each
    // new table; what matters is that it stays far below the ~900 rows of history.
    expect(reads()).toBeLessThan(80);
  });

  it('keeps a first page cheap even with a long history spread over several groups', async () => {
    await seedBigAccount();
    const { db, reads, reset } = counting();
    reset();
    const result = await pullChanges(db, alice.id, { since: 0, limit: 50 });
    expect(result?.hasMore).toBe(true);
    // Not a scan of all ~600 expenses plus categories on every page.
    expect(reads()).toBeLessThan(400);
  });
});
