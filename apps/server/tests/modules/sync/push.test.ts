import { uuidv7 } from '@budget/shared';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { auditLog, expenses, processedMutations } from '../../../src/db/schema';
import { isDuplicateMutation, pushMutations } from '../../../src/modules/sync/push';
import { db, resetDb } from '../../support/helpers';
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
} from '../../support/sync-helpers';

let alice: Person;
let bob: Person;
let groupId: string;
let categoryId: string;

beforeEach(async () => {
  await resetDb();
  alice = await signedIn('alice@example.com', 'Alice');
  bob = await signedIn('bob@example.com', 'Bob');
  groupId = alice.personalGroupId;
  categoryId = (await categoriesOf(alice, groupId))[0]?.id ?? '';
});

const rowOf = async (id: string) =>
  (await db.select().from(expenses).where(eq(expenses.id, id)))[0];

describe('push: creating and editing', () => {
  it('stores a new expense and reports it applied at version 1', async () => {
    const data = expenseData(groupId, alice.id, { categoryId, note: 'Chai' });
    const [result] = await push(alice, [upsert('expense', data)]);
    expect(result).toMatchObject({ status: 'applied', version: 1 });

    const row = await rowOf(data.id);
    expect(row).toMatchObject({
      groupId,
      amountMinor: 10_000,
      note: 'Chai',
      createdBy: alice.id,
      updatedBy: alice.id,
      version: 1,
      deletedAt: null,
    });
    expect(row?.serverSeq).toBeGreaterThan(0);
  });

  it('records an audit entry and an idempotency record in the same batch', async () => {
    const data = expenseData(groupId, alice.id);
    const mutation = upsert('expense', data);
    await push(alice, [mutation]);

    const [audit] = await db.select().from(auditLog).where(eq(auditLog.entityId, data.id));
    expect(audit).toMatchObject({ userId: alice.id, entity: 'expense', groupId, before: null });
    expect(audit?.after).toMatchObject({ id: data.id, version: 1, amountMinor: 10_000 });
    expect(await db.select().from(processedMutations)).toHaveLength(1);
  });

  it('is idempotent: replaying a push changes nothing and reports duplicates', async () => {
    const mutation = upsert('expense', expenseData(groupId, alice.id));
    await push(alice, [mutation]);
    const before = await db.select().from(expenses);

    const [again] = await push(alice, [mutation]);
    expect(again).toEqual({ mutationId: mutation.mutationId, status: 'duplicate' });
    expect(await db.select().from(expenses)).toEqual(before);
    expect(await db.select().from(auditLog)).toHaveLength(1);
  });

  it('survives the same push arriving twice at once: exactly one wins', async () => {
    const mutation = upsert('expense', expenseData(groupId, alice.id));
    const [a, b] = await Promise.all([push(alice, [mutation]), push(alice, [mutation])]);
    expect([a[0]?.status, b[0]?.status].sort()).toEqual(['applied', 'duplicate']);
    expect(await db.select().from(expenses)).toHaveLength(1);
    expect(await db.select().from(auditLog)).toHaveLength(1);
  });

  it('applies the new ones and skips the already-applied ones in a mixed push', async () => {
    const old = upsert('expense', expenseData(groupId, alice.id));
    await push(alice, [old]);
    const fresh = upsert('expense', expenseData(groupId, alice.id));
    const results = await push(alice, [old, fresh]);
    expect(results.map((r) => r.status)).toEqual(['duplicate', 'applied']);
    expect(await db.select().from(expenses)).toHaveLength(2);
  });

  it('edits in place: version goes up, the new data wins, createdBy stays', async () => {
    const data = expenseData(groupId, alice.id, { note: 'before' });
    await push(alice, [upsert('expense', data)]);
    const [edit] = await push(alice, [
      upsert(
        'expense',
        {
          ...data,
          note: 'after',
          amountMinor: 20_000,
          payers: [{ userId: alice.id, amountMinor: 20_000 }],
          shares: [{ userId: alice.id, amountMinor: 20_000 }],
        },
        1,
      ),
    ]);
    expect(edit).toMatchObject({ status: 'applied', version: 2 });
    expect(edit?.conflict).toBeUndefined();
    expect(await rowOf(data.id)).toMatchObject({
      note: 'after',
      amountMinor: 20_000,
      version: 2,
      createdBy: alice.id,
    });
  });

  it('gives each change a higher server_seq than the last', async () => {
    const data = expenseData(groupId, alice.id);
    await push(alice, [upsert('expense', data)]);
    const first = (await rowOf(data.id))?.serverSeq ?? 0;
    await push(alice, [upsert('expense', { ...data, note: 'again' }, 1)]);
    const second = (await rowOf(data.id))?.serverSeq ?? 0;
    expect(second).toBeGreaterThan(first);
  });

  it('flags, but still applies, an edit made from a stale version', async () => {
    const data = expenseData(groupId, alice.id, { note: 'v1' });
    await push(alice, [upsert('expense', data)]);
    await push(alice, [upsert('expense', { ...data, note: 'v2' }, 1)]); // someone else edits

    const [late] = await push(alice, [upsert('expense', { ...data, note: 'from an old copy' }, 1)]);
    expect(late).toMatchObject({ status: 'applied', version: 3, conflict: true });
    expect((await rowOf(data.id))?.note).toBe('from an old copy'); // last writer wins
  });

  it('applies dependent changes in one push, in order', async () => {
    const newCategory = {
      id: uuidv7(),
      groupId,
      name: 'Snacks',
      icon: 'utensils',
      color: '#ff0000',
      archived: false,
    };
    const results = await push(alice, [
      upsert('category', newCategory),
      upsert('expense', expenseData(groupId, alice.id, { categoryId: newCategory.id })),
    ]);
    expect(results.map((r) => r.status)).toEqual(['applied', 'applied']);
  });
});

describe('push: deleting', () => {
  it('tombstones the row rather than removing it, and bumps the version', async () => {
    const data = expenseData(groupId, alice.id);
    await push(alice, [upsert('expense', data)]);
    const [result] = await push(alice, [tombstone('delete', 'expense', data.id, groupId, 1)]);
    expect(result).toMatchObject({ status: 'applied', version: 2 });
    const row = await rowOf(data.id);
    expect(row?.deletedAt).toBeGreaterThan(0);
    expect(row?.version).toBe(2);
  });

  it('lets a delete win over an edit that arrives later', async () => {
    const data = expenseData(groupId, alice.id);
    await push(alice, [upsert('expense', data)]);
    await push(alice, [tombstone('delete', 'expense', data.id, groupId, 1)]);

    const [edit] = await push(alice, [upsert('expense', { ...data, note: 'too late' }, 1)]);
    expect(edit).toMatchObject({ status: 'rejected', reason: 'deleted' });
    expect((await rowOf(data.id))?.note).not.toBe('too late');
  });

  it('undoes a delete with restore, after which edits work again', async () => {
    const data = expenseData(groupId, alice.id);
    await push(alice, [upsert('expense', data)]);
    await push(alice, [tombstone('delete', 'expense', data.id, groupId, 1)]);
    const [restored] = await push(alice, [tombstone('restore', 'expense', data.id, groupId, 2)]);
    expect(restored).toMatchObject({ status: 'applied', version: 3 });
    expect((await rowOf(data.id))?.deletedAt).toBeNull();

    const [edit] = await push(alice, [upsert('expense', { ...data, note: 'back' }, 3)]);
    expect(edit?.status).toBe('applied');
  });

  it('treats deleting twice as a no-op without bumping the version', async () => {
    const data = expenseData(groupId, alice.id);
    await push(alice, [upsert('expense', data)]);
    await push(alice, [tombstone('delete', 'expense', data.id, groupId)]);
    const [again] = await push(alice, [tombstone('delete', 'expense', data.id, groupId)]);
    expect(again).toMatchObject({ status: 'applied', version: 2 });
    expect((await rowOf(data.id))?.version).toBe(2);
    expect(await db.select().from(auditLog)).toHaveLength(2); // create + the one real delete
  });

  it('rejects deleting something that never existed', async () => {
    const [result] = await push(alice, [tombstone('delete', 'expense', uuidv7(), groupId)]);
    expect(result).toMatchObject({ status: 'rejected', reason: 'not_found' });
  });
});

describe('push: authorization', () => {
  it("won't let a non-member write to someone else's group", async () => {
    const [result] = await push(bob, [upsert('expense', expenseData(groupId, bob.id))]);
    expect(result).toMatchObject({ status: 'rejected', reason: 'not_a_member' });
    expect(await db.select().from(expenses)).toHaveLength(0);
  });

  it("won't let someone take over another group's row by reusing its id", async () => {
    const data = expenseData(groupId, alice.id, { note: 'alice only' });
    await push(alice, [upsert('expense', data)]);

    const hijack = {
      ...expenseData(bob.personalGroupId, bob.id, { note: 'hijacked' }),
      id: data.id,
    };
    const [result] = await push(bob, [upsert('expense', hijack)]);
    expect(result).toMatchObject({ status: 'rejected', reason: 'group_mismatch' });
    expect(await rowOf(data.id)).toMatchObject({ note: 'alice only', groupId });

    const [del] = await push(bob, [tombstone('delete', 'expense', data.id, bob.personalGroupId)]);
    expect(del).toMatchObject({ status: 'rejected', reason: 'group_mismatch' });
    expect((await rowOf(data.id))?.deletedAt).toBeNull();
  });

  it('lets any member edit and delete any expense in a shared group, with their name on it', async () => {
    const shared = await createSharedGroup(alice);
    await join(bob, (await makeInvite(alice, shared)).token);
    const data = expenseData(shared, alice.id, {
      payers: [{ userId: alice.id, amountMinor: 10_000 }],
      shares: [
        { userId: alice.id, amountMinor: 5_000 },
        { userId: bob.id, amountMinor: 5_000 },
      ],
    });
    await push(alice, [upsert('expense', data)]);

    const [edit] = await push(bob, [upsert('expense', { ...data, note: 'bob fixed it' }, 1)]);
    expect(edit?.status).toBe('applied');
    expect(await rowOf(data.id)).toMatchObject({
      note: 'bob fixed it',
      createdBy: alice.id,
      updatedBy: bob.id,
    });

    const [del] = await push(bob, [tombstone('delete', 'expense', data.id, shared, 2)]);
    expect(del?.status).toBe('applied');
  });

  it('stops a removed member from writing any more', async () => {
    const shared = await createSharedGroup(alice);
    await join(bob, (await makeInvite(alice, shared)).token);
    await alice.client.request(`/api/groups/${shared}/members/${bob.id}`, { method: 'DELETE' });

    const [result] = await push(bob, [upsert('expense', expenseData(shared, bob.id))]);
    expect(result).toMatchObject({ status: 'rejected', reason: 'not_a_member' });
  });
});

describe('push: references', () => {
  it("rejects a category from another group, and a person who isn't in the group", async () => {
    const bobsCategory = (await categoriesOf(bob, bob.personalGroupId))[0]?.id ?? '';
    const [wrongCategory] = await push(alice, [
      upsert('expense', expenseData(groupId, alice.id, { categoryId: bobsCategory })),
    ]);
    expect(wrongCategory).toMatchObject({ status: 'rejected', reason: 'invalid_reference' });

    const [stranger] = await push(alice, [
      upsert(
        'expense',
        expenseData(groupId, alice.id, {
          payers: [{ userId: alice.id, amountMinor: 10_000 }],
          shares: [{ userId: bob.id, amountMinor: 10_000 }],
        }),
      ),
    ]);
    expect(stranger).toMatchObject({ status: 'rejected', reason: 'invalid_reference' });
  });

  it('still allows editing an old expense that involves someone who has since left', async () => {
    const shared = await createSharedGroup(alice);
    await join(bob, (await makeInvite(alice, shared)).token);
    const data = expenseData(shared, alice.id, {
      shares: [
        { userId: alice.id, amountMinor: 5_000 },
        { userId: bob.id, amountMinor: 5_000 },
      ],
    });
    await push(alice, [upsert('expense', data)]);
    await bob.client.request(`/api/groups/${shared}/members/${bob.id}`, { method: 'DELETE' });

    const [edit] = await push(alice, [upsert('expense', { ...data, note: 'still editable' }, 1)]);
    expect(edit?.status).toBe('applied');
  });

  it('accepts a settlement between members, and rejects one with an outsider', async () => {
    const shared = await createSharedGroup(alice);
    await join(bob, (await makeInvite(alice, shared)).token);
    const settlement = (from: string, to: string) => ({
      id: uuidv7(),
      groupId: shared,
      fromUser: from,
      toUser: to,
      amountMinor: 5_000,
      occurredOn: '2026-10-02',
      note: '',
    });
    const outsider = await signedIn('carol@example.com', 'Carol');
    const results = await push(alice, [
      upsert('settlement', settlement(bob.id, alice.id)),
      upsert('settlement', settlement(outsider.id, alice.id)),
    ]);
    expect(results.map((r) => r.status)).toEqual(['applied', 'rejected']);
  });
});

describe('push: request validation', () => {
  it('requires a session', async () => {
    const response = await new (
      alice.client.constructor as typeof import('../../support/helpers').Client
    )().post('/api/sync/push', { mutations: [] });
    expect(response.status).toBe(401);
  });

  it.each([
    ['an empty push', { mutations: [] }],
    ['no body', {}],
    ['a malformed mutation', { mutations: [{ nope: true }] }],
  ])('400s on %s', async (_label, body) => {
    expect((await alice.client.post('/api/sync/push', body)).status).toBe(400);
  });

  it('400s on an expense whose split does not add up', async () => {
    const bad = expenseData(groupId, alice.id, { shares: [{ userId: alice.id, amountMinor: 1 }] });
    expect(
      (await alice.client.post('/api/sync/push', { mutations: [upsert('expense', bad)] })).status,
    ).toBe(400);
  });

  it('400s on more than 10 mutations, so one request stays inside the D1 query budget', async () => {
    const many = Array.from({ length: 11 }, () =>
      upsert('expense', expenseData(groupId, alice.id)),
    );
    expect((await alice.client.post('/api/sync/push', { mutations: many })).status).toBe(400);
  });

  it('handles a full push of 10 expenses', async () => {
    const many = Array.from({ length: 10 }, () =>
      upsert('expense', expenseData(groupId, alice.id)),
    );
    const results = await push(alice, many);
    expect(results.every((r) => r.status === 'applied')).toBe(true);
    expect((await pullAll(alice)).expenses).toHaveLength(10);
  });

  it('keeps the pull cursor moving past a push', async () => {
    const start = (await pull(alice)).body.cursor;
    await push(alice, [upsert('expense', expenseData(groupId, alice.id))]);
    const next = await pull(alice, { since: start });
    expect(next.body.expenses).toHaveLength(1);
    expect(next.body.cursor).toBeGreaterThan(start);
  });
});

describe('push: what is retried', () => {
  /** A database whose atomic batch fails with the given error, counting the attempts. */
  const failingBatch = (error: Error) => {
    const state = { batches: 0 };
    const broken = Object.create(db, {
      batch: {
        value: async () => {
          state.batches++;
          throw error;
        },
      },
    }) as typeof db;
    return { broken, state };
  };
  const one = () =>
    [upsert('expense', expenseData(groupId, alice.id))] as Parameters<typeof pushMutations>[2];

  it('does not retry an error that is not the duplicate-mutation race', async () => {
    const { broken, state } = failingBatch(new Error('D1_ERROR: database is busy'));
    await expect(pushMutations(broken, alice.id, one(), Date.now())).rejects.toThrow(
      'database is busy',
    );
    expect(state.batches).toBe(1); // one attempt: no second ~40 queries, and the real error surfaces
  });

  it('does retry once when the batch hit the idempotency key', async () => {
    const duplicate = Object.assign(new Error('Failed query'), {
      cause: new Error(
        'UNIQUE constraint failed: processed_mutations.mutation_id: SQLITE_CONSTRAINT',
      ),
    });
    const { broken, state } = failingBatch(duplicate);
    await expect(pushMutations(broken, alice.id, one(), Date.now())).rejects.toBe(duplicate);
    expect(state.batches).toBe(2); // the second pass fails the same way here, so it is rethrown
  });

  it('recognises the duplicate-mutation violation, and nothing else', () => {
    const wrapped = (message: string) =>
      Object.assign(new Error('Failed query'), { cause: new Error(message) });
    expect(
      isDuplicateMutation(wrapped('UNIQUE constraint failed: processed_mutations.mutation_id')),
    ).toBe(true);
    expect(isDuplicateMutation(wrapped('UNIQUE constraint failed: users.google_sub'))).toBe(false);
    expect(isDuplicateMutation(wrapped('FOREIGN KEY constraint failed'))).toBe(false);
    expect(isDuplicateMutation(new Error('boom'))).toBe(false);
    expect(isDuplicateMutation(null)).toBe(false);
  });
});
