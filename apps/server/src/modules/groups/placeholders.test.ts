import { MAX_GROUP_MEMBERS, uuidv7 } from '@budget/shared';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, resetDb } from '../../../test/helpers';
import {
  createSharedGroup,
  expenseData,
  join,
  makeInvite,
  type Person,
  pullAll,
  push,
  signedIn,
  upsert,
} from '../../../test/sync-helpers';
import { memberships, users } from '../../db/schema';

let alice: Person;
let bob: Person;

beforeEach(async () => {
  await resetDb();
  alice = await signedIn('alice@example.com', 'Alice');
  bob = await signedIn('bob@example.com', 'Bob');
});

const add = (by: Person, groupId: string, name: string) =>
  by.client.post(`/api/groups/${groupId}/placeholders`, { name });
const rename = (by: Person, groupId: string, userId: string, name: string) =>
  by.client.request(`/api/groups/${groupId}/placeholders/${userId}`, {
    method: 'PATCH',
    json: { name },
  });

describe('adding someone who does not use the app', () => {
  it('makes them a member that every device sees, flagged as having no app', async () => {
    const groupId = await createSharedGroup(alice);
    const response = await add(alice, groupId, 'Dad');
    expect(response.status).toBe(201);
    const { userId } = (await response.json()) as { userId: string };

    const member = (await pullAll(alice)).members.find((m) => m.userId === userId);
    expect(member).toMatchObject({
      groupId,
      role: 'member',
      removedAt: null,
      displayName: 'Dad',
      isPlaceholder: true,
      avatarUrl: null,
    });
    // Real people are not flagged.
    expect((await pullAll(alice)).members.find((m) => m.userId === alice.id)?.isPlaceholder).toBe(
      false,
    );
  });

  it('is shown to the other members of the group too', async () => {
    const groupId = await createSharedGroup(alice);
    await join(bob, (await makeInvite(alice, groupId)).token);
    await add(alice, groupId, 'Dad');
    expect((await pullAll(bob)).members.some((m) => m.displayName === 'Dad')).toBe(true);
  });

  it('can never be signed in as: its identity matches no Google account', async () => {
    const groupId = await createSharedGroup(alice);
    const { userId } = (await (await add(alice, groupId, 'Dad')).json()) as { userId: string };
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row?.googleSub).toBe(`placeholder:${userId}`);
    expect(row?.email.endsWith('@placeholder.invalid')).toBe(true);
    expect(row?.isPlaceholder).toBe(true);
  });

  it('only the owner of a shared group can add one', async () => {
    const groupId = await createSharedGroup(alice);
    await join(bob, (await makeInvite(alice, groupId)).token);
    expect((await add(bob, groupId, 'Dad')).status).toBe(403);
    expect((await add(alice, alice.personalGroupId, 'Dad')).status).toBe(403);
    const stranger = await signedIn('stranger@example.com');
    expect((await add(stranger, groupId, 'Dad')).status).toBe(403);
  });

  it('wants a sensible name', async () => {
    const groupId = await createSharedGroup(alice);
    expect((await add(alice, groupId, '   ')).status).toBe(400);
    expect((await add(alice, groupId, 'x'.repeat(101))).status).toBe(400);
  });

  it('counts towards the size of the group', async () => {
    const groupId = await createSharedGroup(alice);
    for (let i = 1; i < MAX_GROUP_MEMBERS; i++) {
      expect((await add(alice, groupId, `Friend ${i}`)).status).toBe(201);
    }
    expect((await add(alice, groupId, 'One too many')).status).toBe(409);
    const active = (
      await db.select().from(memberships).where(eq(memberships.groupId, groupId))
    ).filter((m) => m.removedAt === null);
    expect(active).toHaveLength(MAX_GROUP_MEMBERS);
  });
});

describe('using them in expenses', () => {
  it('lets an expense be split with them, and shows it in the pull', async () => {
    const groupId = await createSharedGroup(alice);
    const { userId: dad } = (await (await add(alice, groupId, 'Dad')).json()) as { userId: string };

    const data = expenseData(groupId, alice.id, {
      amountMinor: 10_000,
      payers: [{ userId: alice.id, amountMinor: 10_000 }],
      shares: [
        { userId: alice.id, amountMinor: 5_000 },
        { userId: dad, amountMinor: 5_000 },
      ],
    });
    const [result] = await push(alice, [upsert('expense', data)]);
    expect(result?.status).toBe('applied');
    expect((await pullAll(alice)).expenses.find((e) => e.id === data.id)?.shares).toHaveLength(2);
  });

  it('still refuses a stranger who is not in the group', async () => {
    const groupId = await createSharedGroup(alice);
    const data = expenseData(groupId, alice.id, {
      shares: [{ userId: bob.id, amountMinor: 10_000 }],
    });
    const [result] = await push(alice, [upsert('expense', data)]);
    expect(result).toMatchObject({ status: 'rejected', reason: 'invalid_reference' });
  });
});

describe('managing them', () => {
  it('lets the owner rename one, which reaches every device', async () => {
    const groupId = await createSharedGroup(alice);
    await join(bob, (await makeInvite(alice, groupId)).token);
    const { userId } = (await (await add(alice, groupId, 'Dda')).json()) as { userId: string };
    const cursor = (await pullAll(bob)).cursor;

    expect((await rename(alice, groupId, userId, 'Dad')).status).toBe(200);
    const after = await pullAll(bob, cursor);
    expect(after.members.find((m) => m.userId === userId)?.displayName).toBe('Dad');
  });

  it("can't rename a real person, or a stranger, or as a non-owner", async () => {
    const groupId = await createSharedGroup(alice);
    await join(bob, (await makeInvite(alice, groupId)).token);
    const { userId } = (await (await add(alice, groupId, 'Dad')).json()) as { userId: string };

    expect((await rename(alice, groupId, bob.id, 'Robert')).status).toBe(404);
    expect((await rename(alice, groupId, uuidv7(), 'Nobody')).status).toBe(404);
    expect((await rename(bob, groupId, userId, 'Not mine')).status).toBe(403);
    const [bobRow] = await db.select().from(users).where(eq(users.id, bob.id));
    expect(bobRow?.displayName).toBe('Bob');
  });

  it('can be removed and added back like any member', async () => {
    const groupId = await createSharedGroup(alice);
    const { userId } = (await (await add(alice, groupId, 'Dad')).json()) as { userId: string };

    const removed = await alice.client.request(`/api/groups/${groupId}/members/${userId}`, {
      method: 'DELETE',
    });
    expect(removed.status).toBe(200);
    expect(
      (await pullAll(alice)).members.find((m) => m.userId === userId)?.removedAt,
    ).not.toBeNull();

    const back = await alice.client.post(`/api/groups/${groupId}/members/${userId}/reinstate`);
    expect(back.status).toBe(200);
  });

  it('cannot be made the owner', async () => {
    const groupId = await createSharedGroup(alice);
    const { userId } = (await (await add(alice, groupId, 'Dad')).json()) as { userId: string };
    const response = await alice.client.post(`/api/groups/${groupId}/transfer`, { userId });
    expect(response.status).toBe(409);
    const roles = await db.select().from(memberships).where(eq(memberships.groupId, groupId));
    expect(roles.find((m) => m.userId === alice.id)?.role).toBe('owner');
  });
});
