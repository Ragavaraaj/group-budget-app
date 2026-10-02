import { MAX_GROUP_MEMBERS, MAX_GROUPS_PER_USER, uuidv7 } from '@budget/shared';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { Client, db, resetDb, sha256Hex } from '../../../test/helpers';
import {
  createSharedGroup,
  join,
  makeInvite,
  type Person,
  pull,
  pullAll,
  signedIn,
} from '../../../test/sync-helpers';
import { groups, invites, memberships } from '../../db/schema';
import { joinGuarded } from './repo';

let alice: Person;
let bob: Person;

beforeEach(async () => {
  await resetDb();
  alice = await signedIn('alice@example.com', 'Alice');
  bob = await signedIn('bob@example.com', 'Bob');
});

const remove = (by: Person, groupId: string, userId: string) =>
  by.client.request(`/api/groups/${groupId}/members/${userId}`, { method: 'DELETE' });

describe('creating a group', () => {
  it('makes the caller the owner and seeds the default categories', async () => {
    const groupId = await createSharedGroup(alice, 'Goa trip');
    const all = await pullAll(alice);
    expect(all.groups.find((g) => g.id === groupId)).toMatchObject({
      name: 'Goa trip',
      isPersonal: false,
      createdBy: alice.id,
    });
    expect(all.members.find((m) => m.groupId === groupId)).toMatchObject({
      userId: alice.id,
      role: 'owner',
    });
    expect(all.categories.filter((c) => c.groupId === groupId)).toHaveLength(10);
  });

  it('is safe to retry with the same id', async () => {
    const id = uuidv7();
    const first = await alice.client.post('/api/groups', { id, name: 'Trip' });
    const again = await alice.client.post('/api/groups', { id, name: 'Trip' });
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(await db.select().from(groups).where(eq(groups.id, id))).toHaveLength(1);
  });

  it("won't let someone claim an id that belongs to another group", async () => {
    const id = uuidv7();
    await alice.client.post('/api/groups', { id, name: 'Trip' });
    expect((await bob.client.post('/api/groups', { id, name: 'Mine now' })).status).toBe(409);
    expect(
      (await alice.client.post('/api/groups', { id: alice.personalGroupId, name: 'x' })).status,
    ).toBe(409);
  });

  it('validates the name and needs a session', async () => {
    expect((await alice.client.post('/api/groups', { name: '   ' })).status).toBe(400);
    expect((await alice.client.post('/api/groups', { name: 'x'.repeat(61) })).status).toBe(400);
    expect((await new Client().post('/api/groups', { name: 'Trip' })).status).toBe(401);
  });

  it('stops at the per-person group limit', async () => {
    for (let i = 1; i < MAX_GROUPS_PER_USER; i++) await createSharedGroup(alice, `g${i}`); // personal counts as one
    const over = await alice.client.post('/api/groups', { name: 'one too many' });
    expect(over.status).toBe(409);
    expect(await over.json()).toEqual({ error: 'too_many_groups' });
  });
});

describe('renaming', () => {
  it('lets the owner rename, and the change syncs as a new version', async () => {
    const groupId = await createSharedGroup(alice, 'Old');
    const cursor = (await pullAll(alice)).cursor;
    const response = await alice.client.request(`/api/groups/${groupId}`, {
      method: 'PATCH',
      json: { name: 'New name' },
    });
    expect(response.status).toBe(200);

    const { body } = await pull(alice, { since: cursor });
    expect(body.groups).toEqual([
      expect.objectContaining({ id: groupId, name: 'New name', version: 2 }),
    ]);
  });

  it('refuses members, non-members and the personal ledger', async () => {
    const groupId = await createSharedGroup(alice);
    await join(bob, (await makeInvite(alice, groupId)).token);
    const rename = (by: Person, id: string) =>
      by.client.request(`/api/groups/${id}`, { method: 'PATCH', json: { name: 'x' } });
    expect((await rename(bob, groupId)).status).toBe(403);
    expect((await rename(await signedIn('carol@example.com'), groupId)).status).toBe(404);
    expect((await rename(alice, alice.personalGroupId)).status).toBe(403);
  });
});

describe('invites', () => {
  it('can be made by the owner only, and never for a personal ledger', async () => {
    const groupId = await createSharedGroup(alice);
    await join(bob, (await makeInvite(alice, groupId)).token);
    expect((await bob.client.post(`/api/groups/${groupId}/invites`)).status).toBe(403);
    expect((await alice.client.post(`/api/groups/${alice.personalGroupId}/invites`)).status).toBe(
      403,
    );
    expect(
      (await (await signedIn('carol@example.com')).client.post(`/api/groups/${groupId}/invites`))
        .status,
    ).toBe(404);
  });

  it('stores only a hash of the token, with a one-week expiry', async () => {
    const groupId = await createSharedGroup(alice);
    const invite = await makeInvite(alice, groupId);
    const [row] = await db.select().from(invites).where(eq(invites.groupId, groupId));
    expect(row?.tokenHash).toBe(await sha256Hex(invite.token));
    expect(JSON.stringify(row)).not.toContain(invite.token);
    expect(invite.expiresAt - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    expect(invite.expiresAt - Date.now()).toBeLessThan(7.1 * 86_400_000);
  });

  it('previews the group for someone who is not signed in yet', async () => {
    const groupId = await createSharedGroup(alice, 'Goa trip');
    const { token } = await makeInvite(alice, groupId);
    const preview = await new Client().get(`/api/invites/preview?token=${token}`);
    expect(await preview.json()).toEqual({
      valid: true,
      groupName: 'Goa trip',
      invitedBy: 'Alice',
    });
    expect(
      await (await new Client().get('/api/invites/preview?token=not-a-real-token-at-all')).json(),
    ).toEqual({ valid: false });
    expect(await (await new Client().get('/api/invites/preview')).json()).toEqual({ valid: false });
  });

  it('adds the person to the group and counts the use once', async () => {
    const groupId = await createSharedGroup(alice);
    const { token } = await makeInvite(alice, groupId);
    const response = await join(bob, token);
    expect(await response.json()).toEqual({ groupId });

    const [membership] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.groupId, groupId), eq(memberships.userId, bob.id)));
    expect(membership).toMatchObject({ role: 'member', removedAt: null });

    await join(bob, token); // opening the link again must not use it up
    const [row] = await db.select().from(invites);
    expect(row?.usedCount).toBe(1);
  });

  it.each([
    ['expired', { expiresAt: Date.now() - 1 }],
    ['revoked', { revokedAt: Date.now() }],
    ['used up', { usedCount: 20 }],
  ])('refuses an invite that is %s', async (_label, patch) => {
    const groupId = await createSharedGroup(alice);
    const { token } = await makeInvite(alice, groupId);
    await db.update(invites).set(patch);
    const response = await join(bob, token);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'invite_invalid' });
  });

  it('refuses a made-up token and a malformed request', async () => {
    expect((await join(bob, 'definitely-not-a-valid-token-1234')).status).toBe(404);
    expect((await bob.client.post('/api/invites/accept', { token: 'x' })).status).toBe(400);
    expect((await new Client().post('/api/invites/accept', { token: 'x'.repeat(30) })).status).toBe(
      401,
    );
  });

  it('refuses when the group is full', async () => {
    const groupId = await createSharedGroup(alice);
    const { token } = await makeInvite(alice, groupId);
    // Fill the group with placeholder users straight in the database. D1 allows 100 bound
    // parameters per statement, so insert them in small chunks.
    const { users } = await import('../../db/schema');
    const filler = Array.from({ length: MAX_GROUP_MEMBERS - 1 }, (_, n) => ({ id: uuidv7(), n }));
    for (let i = 0; i < filler.length; i += 10) {
      const chunk = filler.slice(i, i + 10);
      await db.batch([
        db.insert(users).values(
          chunk.map(({ id, n }) => ({
            id,
            googleSub: `filler-${n}`,
            email: `f${n}@example.com`,
            displayName: `F${n}`,
            createdAt: new Date(),
            lastLoginAt: new Date(),
          })),
        ),
        db.insert(memberships).values(
          chunk.map(({ id, n }) => ({
            groupId,
            userId: id,
            role: 'member' as const,
            joinedAt: 1,
            removedAt: null,
            serverSeq: 1000 + n,
          })),
        ),
      ]);
    }
    const response = await join(bob, token);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'group_full' });
  });
});

describe('removing and leaving', () => {
  it('lets the owner remove a member, who then no longer belongs', async () => {
    const groupId = await createSharedGroup(alice);
    await join(bob, (await makeInvite(alice, groupId)).token);
    expect((await remove(alice, groupId, bob.id)).status).toBe(200);

    const [row] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.groupId, groupId), eq(memberships.userId, bob.id)));
    expect(row?.removedAt).toBeGreaterThan(0);
    expect((await pull(bob, { groupId })).status).toBe(403);
  });

  it('lets a member leave, but not remove someone else', async () => {
    const groupId = await createSharedGroup(alice);
    const carol = await signedIn('carol@example.com', 'Carol');
    const { token } = await makeInvite(alice, groupId);
    await join(bob, token);
    await join(carol, token);

    expect((await remove(bob, groupId, carol.id)).status).toBe(403);
    expect((await remove(bob, groupId, bob.id)).status).toBe(200);
  });

  it('does not let the owner leave, or anyone touch a personal ledger or a stranger', async () => {
    const groupId = await createSharedGroup(alice);
    const response = await remove(alice, groupId, alice.id);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'owner_cannot_leave' });

    expect((await remove(alice, alice.personalGroupId, alice.id)).status).toBe(403);
    expect((await remove(alice, groupId, bob.id)).status).toBe(404); // bob isn't in it
    expect((await remove(bob, groupId, alice.id)).status).toBe(404); // bob isn't a member
  });

  it('lets someone who left rejoin with a fresh invite', async () => {
    const groupId = await createSharedGroup(alice);
    await join(bob, (await makeInvite(alice, groupId)).token);
    await remove(bob, groupId, bob.id); // bob leaves of his own accord
    expect((await join(bob, (await makeInvite(alice, groupId)).token)).status).toBe(200);
    const all = await pullAll(bob);
    expect(
      all.members.find((m) => m.groupId === groupId && m.userId === bob.id)?.removedAt,
    ).toBeNull();
  });

  it('does not let someone the owner removed back in through an invite link', async () => {
    const groupId = await createSharedGroup(alice);
    const { token } = await makeInvite(alice, groupId);
    await join(bob, token);
    await remove(alice, groupId, bob.id);

    // The link he already has, and a brand new one: neither undoes the removal.
    for (const link of [token, (await makeInvite(alice, groupId)).token]) {
      const response = await join(bob, link);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'removed' });
    }
    expect((await pull(bob, { groupId })).status).toBe(403);
  });
});

describe('reinstating', () => {
  it('lets the owner bring a removed person back directly', async () => {
    const groupId = await createSharedGroup(alice);
    await join(bob, (await makeInvite(alice, groupId)).token);
    await remove(alice, groupId, bob.id);

    const response = await alice.client.post(`/api/groups/${groupId}/members/${bob.id}/reinstate`);
    expect(response.status).toBe(200);
    const all = await pullAll(bob);
    expect(
      all.members.find((m) => m.groupId === groupId && m.userId === bob.id)?.removedAt,
    ).toBeNull();
    expect((await pull(bob, { groupId })).status).toBe(200);
  });

  it('is for the owner only, and only for someone who was removed', async () => {
    const groupId = await createSharedGroup(alice);
    const carol = await signedIn('carol@example.com', 'Carol');
    const { token } = await makeInvite(alice, groupId);
    await join(bob, token);
    await join(carol, token);
    await remove(alice, groupId, carol.id);

    const reinstate = (by: Person, who: Person) =>
      by.client.post(`/api/groups/${groupId}/members/${who.id}/reinstate`);
    expect((await reinstate(bob, carol)).status).toBe(403); // not the owner
    expect((await reinstate(alice, bob)).status).toBe(404); // bob was never removed
    expect((await reinstate(alice, carol)).status).toBe(200);
  });
});

describe('revoking invite links', () => {
  it('stops every open link, for the owner only', async () => {
    const groupId = await createSharedGroup(alice);
    const first = await makeInvite(alice, groupId);
    const second = await makeInvite(alice, groupId);
    await join(bob, first.token);
    const carol = await signedIn('carol@example.com', 'Carol');

    expect(
      (await bob.client.request(`/api/groups/${groupId}/invites`, { method: 'DELETE' })).status,
    ).toBe(403);
    const response = await alice.client.request(`/api/groups/${groupId}/invites`, {
      method: 'DELETE',
    });
    expect(await response.json()).toEqual({ revoked: 2 });

    expect((await join(carol, second.token)).status).toBe(404);
    expect(
      await (await new Client().get(`/api/invites/preview?token=${second.token}`)).json(),
    ).toEqual({ valid: false });
    // Links made afterwards work again.
    expect((await join(carol, (await makeInvite(alice, groupId)).token)).status).toBe(200);
  });
});

describe('the guarded join (two people racing for the last place)', () => {
  const tokenOf = async (groupId: string) => {
    const { token } = await makeInvite(alice, groupId);
    const [row] = await db
      .select()
      .from(invites)
      .where(eq(invites.tokenHash, await sha256Hex(token)));
    return { token, invite: { id: row?.id ?? '', groupId } };
  };

  it('uses an invite with one use left for exactly one of two simultaneous joiners', async () => {
    const groupId = await createSharedGroup(alice);
    const { invite } = await tokenOf(groupId);
    await db.update(invites).set({ maxUses: 1 }).where(eq(invites.id, invite.id));
    const carol = await signedIn('carol@example.com', 'Carol');

    // Both have passed their checks; only the writes race.
    await Promise.all([
      joinGuarded(db, invite, bob.id, Date.now()),
      joinGuarded(db, invite, carol.id, Date.now()),
    ]);

    const active = await db.select().from(memberships).where(eq(memberships.groupId, groupId));
    expect(active.filter((m) => m.removedAt === null)).toHaveLength(2); // the owner and one newcomer
    const [row] = await db.select().from(invites).where(eq(invites.id, invite.id));
    expect(row?.usedCount).toBe(1);
  });

  it('never takes a group past its member limit', async () => {
    const groupId = await createSharedGroup(alice);
    const { invite } = await tokenOf(groupId);
    const { users } = await import('../../db/schema');
    const filler = Array.from({ length: MAX_GROUP_MEMBERS - 2 }, (_, n) => ({ id: uuidv7(), n }));
    for (let i = 0; i < filler.length; i += 10) {
      const chunk = filler.slice(i, i + 10);
      await db.batch([
        db.insert(users).values(
          chunk.map(({ id, n }) => ({
            id,
            googleSub: `f-${n}`,
            email: `f${n}@example.com`,
            displayName: `F${n}`,
            createdAt: new Date(),
            lastLoginAt: new Date(),
          })),
        ),
        db.insert(memberships).values(
          chunk.map(({ id, n }) => ({
            groupId,
            userId: id,
            role: 'member' as const,
            joinedAt: 1,
            removedAt: null,
            serverSeq: 2000 + n,
          })),
        ),
      ]);
    }
    // Owner + 48 fillers = 49 members: one place left, two people want it.
    const carol = await signedIn('carol@example.com', 'Carol');
    await Promise.all([
      joinGuarded(db, invite, bob.id, Date.now()),
      joinGuarded(db, invite, carol.id, Date.now()),
    ]);

    const members = await db.select().from(memberships).where(eq(memberships.groupId, groupId));
    expect(members.filter((m) => m.removedAt === null)).toHaveLength(MAX_GROUP_MEMBERS);
  });

  it('refuses an expired or revoked invite even if the earlier checks were passed', async () => {
    const groupId = await createSharedGroup(alice);
    const { invite } = await tokenOf(groupId);
    await db.update(invites).set({ revokedAt: Date.now() }).where(eq(invites.id, invite.id));
    await joinGuarded(db, invite, bob.id, Date.now());
    const mine = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.groupId, groupId), eq(memberships.userId, bob.id)));
    expect(mine).toHaveLength(0);
    const [row] = await db.select().from(invites).where(eq(invites.id, invite.id));
    expect(row?.usedCount).toBe(0);
  });
});
