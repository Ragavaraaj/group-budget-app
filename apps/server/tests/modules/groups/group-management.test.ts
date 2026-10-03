import { type ListInvitesResponse, uuidv7 } from '@budget/shared';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  auditLog,
  budgets,
  categories,
  expenses,
  groups,
  invites,
  memberships,
  recurringRules,
  settlements,
} from '../../../src/db/schema';
import { db, resetDb, sha256Hex } from '../../support/helpers';
import {
  categoriesOf,
  createSharedGroup,
  expenseData,
  join,
  makeInvite,
  type Person,
  pullAll,
  push,
  signedIn,
  upsert,
} from '../../support/sync-helpers';

let alice: Person;
let bob: Person;
let carol: Person;

beforeEach(async () => {
  await resetDb();
  alice = await signedIn('alice@example.com', 'Alice');
  bob = await signedIn('bob@example.com', 'Bob');
  carol = await signedIn('carol@example.com', 'Carol');
});

const listInvites = (by: Person, groupId: string) =>
  by.client.get(`/api/groups/${groupId}/invites`);
const revokeOne = (by: Person, groupId: string, inviteId: string) =>
  by.client.request(`/api/groups/${groupId}/invites/${inviteId}`, { method: 'DELETE' });
const transfer = (by: Person, groupId: string, userId: string) =>
  by.client.post(`/api/groups/${groupId}/transfer`, { userId });
const deleteGroup = (by: Person, groupId: string) =>
  by.client.request(`/api/groups/${groupId}`, { method: 'DELETE' });

const roles = async (groupId: string) =>
  Object.fromEntries(
    (await db.select().from(memberships).where(eq(memberships.groupId, groupId))).map((m) => [
      m.userId,
      m.role,
    ]),
  );

describe('invite links, one at a time', () => {
  it('lists the links that can still be used, with how much each has been used', async () => {
    const groupId = await createSharedGroup(alice);
    const first = await makeInvite(alice, groupId);
    await makeInvite(alice, groupId);
    await join(bob, first.token);

    const response = await listInvites(alice, groupId);
    expect(response.status).toBe(200);
    const { invites: open } = (await response.json()) as ListInvitesResponse;
    expect(open).toHaveLength(2);
    expect(open.map((i) => i.usedCount).sort()).toEqual([0, 1]);
    expect(open[0]).toHaveProperty('expiresAt');
    // The link itself is never given back: only its hash is stored.
    expect(JSON.stringify(open)).not.toContain(first.token);
  });

  it('is for the owner only', async () => {
    const groupId = await createSharedGroup(alice);
    await join(bob, (await makeInvite(alice, groupId)).token);
    expect((await listInvites(bob, groupId)).status).toBe(403);
    expect((await listInvites(carol, groupId)).status).toBe(404);
  });

  it('ends one link and leaves the others working', async () => {
    const groupId = await createSharedGroup(alice);
    const keep = await makeInvite(alice, groupId);
    const stop = await makeInvite(alice, groupId);
    const stopHash = await sha256Hex(stop.token);
    const stopId = (await db.select().from(invites).where(eq(invites.groupId, groupId))).find(
      (row) => row.tokenHash === stopHash,
    )?.id;

    expect((await revokeOne(alice, groupId, stopId ?? '')).status).toBe(200);

    const left = ((await (await listInvites(alice, groupId)).json()) as ListInvitesResponse)
      .invites;
    expect(left).toHaveLength(1);
    expect(left[0]?.id).not.toBe(stopId);

    expect((await join(carol, stop.token)).status).toBe(404);
    expect((await join(bob, keep.token)).status).toBe(200);
  });

  it("won't end a link of another group, or one that doesn't exist, or for a non-owner", async () => {
    const mine = await createSharedGroup(alice, 'Mine');
    const theirs = await createSharedGroup(bob, 'Theirs');
    await makeInvite(bob, theirs);
    const bobsInvite = (await db.select().from(invites).where(eq(invites.groupId, theirs)))[0];

    expect((await revokeOne(alice, mine, bobsInvite?.id ?? '')).status).toBe(404);
    expect((await revokeOne(alice, mine, uuidv7())).status).toBe(404);
    expect((await revokeOne(alice, theirs, bobsInvite?.id ?? '')).status).toBe(404);
    expect((await revokeOne(bob, theirs, bobsInvite?.id ?? '')).status).toBe(200);
    expect((await revokeOne(bob, theirs, bobsInvite?.id ?? '')).status).toBe(404); // already ended
  });
});

describe('handing a group to someone else', () => {
  it('makes the other person the owner and the old owner an ordinary member', async () => {
    const groupId = await createSharedGroup(alice);
    await join(bob, (await makeInvite(alice, groupId)).token);

    const response = await transfer(alice, groupId, bob.id);
    expect(response.status).toBe(200);
    expect(await roles(groupId)).toEqual({ [alice.id]: 'member', [bob.id]: 'owner' });

    // Both devices hear about it through the normal pull.
    const seen = (await pullAll(bob)).members.filter((m) => m.groupId === groupId);
    expect(seen.find((m) => m.userId === bob.id)?.role).toBe('owner');
    expect(seen.find((m) => m.userId === alice.id)?.role).toBe('member');
  });

  it('lets the new owner do owner things and the old owner leave', async () => {
    const groupId = await createSharedGroup(alice);
    await join(bob, (await makeInvite(alice, groupId)).token);
    await transfer(alice, groupId, bob.id);

    const rename = (by: Person) =>
      by.client.request(`/api/groups/${groupId}`, { method: 'PATCH', json: { name: 'Renamed' } });
    expect((await rename(bob)).status).toBe(200);
    expect((await rename(alice)).status).toBe(403);
    const left = await alice.client.request(`/api/groups/${groupId}/members/${alice.id}`, {
      method: 'DELETE',
    });
    expect(left.status).toBe(200);
  });

  it('is only for the owner, to an active member, and not to oneself', async () => {
    const groupId = await createSharedGroup(alice);
    await join(bob, (await makeInvite(alice, groupId)).token);
    await join(carol, (await makeInvite(alice, groupId)).token);

    expect((await transfer(bob, groupId, carol.id)).status).toBe(403);
    expect((await transfer(alice, groupId, alice.id)).status).toBe(409);
    expect((await transfer(alice, groupId, uuidv7())).status).toBe(404);

    await alice.client.request(`/api/groups/${groupId}/members/${carol.id}`, { method: 'DELETE' });
    expect((await transfer(alice, groupId, carol.id)).status).toBe(404);
    expect(await roles(groupId)).toMatchObject({ [alice.id]: 'owner' });
  });

  it('cannot be done for a personal ledger', async () => {
    expect((await transfer(alice, alice.personalGroupId, bob.id)).status).toBe(403);
  });

  it('leaves exactly one owner when two hand-overs race', async () => {
    const groupId = await createSharedGroup(alice);
    await join(bob, (await makeInvite(alice, groupId)).token);
    await join(carol, (await makeInvite(alice, groupId)).token);

    await Promise.all([transfer(alice, groupId, bob.id), transfer(alice, groupId, carol.id)]);
    const owners = Object.values(await roles(groupId)).filter((role) => role === 'owner');
    expect(owners).toHaveLength(1);
  });
});

describe('deleting a group', () => {
  async function groupWithEverything() {
    const groupId = await createSharedGroup(alice, 'Goa trip');
    await join(bob, (await makeInvite(alice, groupId)).token);
    await join(carol, (await makeInvite(alice, groupId)).token);
    const categoryId = (await categoriesOf(alice, groupId))[0]?.id ?? null;
    const shares = [
      { userId: alice.id, amountMinor: 5_000 },
      { userId: bob.id, amountMinor: 5_000 },
    ];
    await push(alice, [
      upsert('expense', expenseData(groupId, alice.id, { categoryId, shares })),
      upsert('budget', { id: uuidv7(), groupId, categoryId: null, amountMinor: 100_000 }),
      upsert('recurring', {
        ...(({ occurredOn: _day, ...rest }) => rest)(expenseData(groupId, alice.id, { shares })),
        frequency: 'monthly',
        startOn: '2026-11-01',
        endOn: null,
        active: true,
      }),
    ]);
    return groupId;
  }

  it('erases everything in the group and removes every member', async () => {
    const groupId = await groupWithEverything();
    const response = await deleteGroup(alice, groupId);
    expect(response.status).toBe(200);

    expect(await db.select().from(expenses).where(eq(expenses.groupId, groupId))).toHaveLength(0);
    expect(
      await db.select().from(settlements).where(eq(settlements.groupId, groupId)),
    ).toHaveLength(0);
    expect(await db.select().from(categories).where(eq(categories.groupId, groupId))).toHaveLength(
      0,
    );
    expect(await db.select().from(budgets).where(eq(budgets.groupId, groupId))).toHaveLength(0);
    expect(
      await db.select().from(recurringRules).where(eq(recurringRules.groupId, groupId)),
    ).toHaveLength(0);
    expect(await db.select().from(invites).where(eq(invites.groupId, groupId))).toHaveLength(0);
    expect(await db.select().from(auditLog).where(eq(auditLog.groupId, groupId))).toHaveLength(0);

    const members = await db.select().from(memberships).where(eq(memberships.groupId, groupId));
    expect(members).toHaveLength(3);
    expect(members.every((m) => m.removedAt !== null && m.removedBy === alice.id)).toBe(true);
    // The group's own row stays: it is how the removal is explained to devices.
    expect(await db.select().from(groups).where(eq(groups.id, groupId))).toHaveLength(1);
  });

  it('gives every member their own change number, so a device pulling in pages misses none', async () => {
    const groupId = await groupWithEverything();
    await deleteGroup(alice, groupId);
    const seqs = (await db.select().from(memberships).where(eq(memberships.groupId, groupId))).map(
      (m) => m.serverSeq,
    );
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('tells every member’s devices, which then drop the group', async () => {
    const groupId = await groupWithEverything();
    const before = (await pullAll(bob)).cursor;
    await deleteGroup(alice, groupId);

    const after = await pullAll(bob, before);
    const mine = after.members.find((m) => m.groupId === groupId && m.userId === bob.id);
    expect(mine?.removedAt).not.toBeNull();
    // Nothing of the group's content is sent any more.
    expect(after.expenses.filter((e) => e.groupId === groupId)).toHaveLength(0);
    expect(after.groups.filter((g) => g.id === groupId)).toHaveLength(0);
    // And they can't ask for it directly.
    const direct = await bob.client.get(`/api/sync/pull?since=0&groupId=${groupId}`);
    expect(direct.status).toBe(403);
  });

  it('stops the invite links working', async () => {
    const groupId = await createSharedGroup(alice);
    const link = await makeInvite(alice, groupId);
    await deleteGroup(alice, groupId);
    expect((await join(bob, link.token)).status).toBe(404);
  });

  it('is for the owner of a shared group only, and leaves other groups alone', async () => {
    const groupId = await groupWithEverything();
    expect((await deleteGroup(bob, groupId)).status).toBe(403);
    expect((await deleteGroup(carol, uuidv7())).status).toBe(403);
    expect((await deleteGroup(alice, alice.personalGroupId)).status).toBe(403);
    expect(await db.select().from(expenses).where(eq(expenses.groupId, groupId))).toHaveLength(1);

    const personal = await categoriesOf(alice, alice.personalGroupId);
    expect(personal.length).toBeGreaterThan(0);
  });

  it('can be repeated without harm', async () => {
    const groupId = await groupWithEverything();
    expect((await deleteGroup(alice, groupId)).status).toBe(200);
    // The owner has been removed too, so the second request is simply refused.
    expect((await deleteGroup(alice, groupId)).status).toBe(403);
  });
});
