import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { devSignIn, missingId, ORIGIN, signedInApi, uniqueEmail } from './helpers';

// The browser tests above show what the app offers. These call the Worker directly, as someone
// writing their own client (or an attacker) would, to prove that what the app does not offer is
// not allowed either. Every call carries the right Origin, so a refusal is about permission or
// input and never about a missing header.

type Api = APIRequestContext;

interface Setup {
  owner: Api;
  member: Api;
  outsider: Api;
  groupId: string;
  ownerId: string;
  memberId: string;
  outsiderId: string;
  token: string;
}

async function me(api: Api): Promise<string> {
  return (await (await api.get('/api/me')).json()).user.id;
}

/** An owner with a group, a member who joined through an invite, and an outsider. */
async function setup(playwright: Parameters<typeof signedInApi>[0]): Promise<Setup> {
  const owner = await signedInApi(playwright, uniqueEmail('owner'), 'Owner');
  const member = await signedInApi(playwright, uniqueEmail('member'), 'Member');
  const outsider = await signedInApi(playwright, uniqueEmail('outsider'), 'Outsider');

  const created = await owner.post('/api/groups', { data: { name: 'API group' } });
  expect(created.status()).toBe(201);
  const { groupId } = await created.json();
  const invite = await (await owner.post(`/api/groups/${groupId}/invites`, { data: {} })).json();
  const joined = await member.post('/api/invites/accept', { data: { token: invite.token } });
  expect(joined.status()).toBe(200);

  return {
    owner,
    member,
    outsider,
    groupId,
    ownerId: await me(owner),
    memberId: await me(member),
    outsiderId: await me(outsider),
    token: invite.token,
  };
}

/** A new expense in `groupId`, paid and owed by `userId`, as the sync endpoint wants it. */
function expenseMutation(groupId: string, userId: string, id = missingId()) {
  return {
    mutationId: missingId(),
    baseVersion: null,
    createdAt: Date.now(),
    op: 'upsert',
    entity: 'expense',
    data: {
      id,
      groupId,
      occurredOn: '2026-01-15',
      amountMinor: 10_000,
      categoryId: null,
      note: 'API expense',
      splitType: 'equal',
      payers: [{ userId, amountMinor: 10_000 }],
      shares: [{ userId, amountMinor: 10_000 }],
    },
  };
}

async function expectError(
  response: Awaited<ReturnType<Api['get']>>,
  status: number,
  error: string,
  why?: string,
) {
  expect(response.status(), why ?? (await response.text())).toBe(status);
  expect(await response.json()).toEqual({ error });
}

test.describe('who may manage a group', () => {
  test('a member who is not the owner is refused every owner action, and nothing changes', async ({
    playwright,
  }) => {
    const { owner, member, groupId, ownerId, memberId } = await setup(playwright);
    const placeholder = await (
      await owner.post(`/api/groups/${groupId}/placeholders`, { data: { name: 'Sam' } })
    ).json();
    const open = await (await owner.get(`/api/groups/${groupId}/invites`)).json();
    const base = `/api/groups/${groupId}`;

    await expectError(await member.post(`${base}/invites`, { data: {} }), 403, 'forbidden');
    await expectError(await member.get(`${base}/invites`), 403, 'forbidden');
    await expectError(await member.delete(`${base}/invites`), 403, 'forbidden');
    await expectError(
      await member.delete(`${base}/invites/${open.invites[0].id}`),
      403,
      'forbidden',
    );
    await expectError(await member.patch(base, { data: { name: 'Hijacked' } }), 403, 'forbidden');
    await expectError(
      await member.post(`${base}/placeholders`, { data: { name: 'Ghost' } }),
      403,
      'forbidden',
    );
    await expectError(
      await member.patch(`${base}/placeholders/${placeholder.userId}`, { data: { name: 'Ghost' } }),
      403,
      'forbidden',
    );
    await expectError(
      await member.post(`${base}/transfer`, { data: { userId: memberId } }),
      403,
      'forbidden',
    );
    await expectError(await member.delete(`${base}/members/${ownerId}`), 403, 'forbidden');
    await expectError(await member.post(`${base}/members/${memberId}/reinstate`), 403, 'forbidden');
    await expectError(await member.delete(base), 403, 'forbidden');

    // The group is exactly as it was: same name, same owner, the link still open, Sam unrenamed.
    const pull = await (await owner.get('/api/sync/pull')).json();
    const group = pull.groups.find((g: { id: string }) => g.id === groupId);
    expect(group.name).toBe('API group');
    const owners = pull.members.filter(
      (m: { groupId: string; role: string; removedAt: number | null }) =>
        m.groupId === groupId && m.role === 'owner' && m.removedAt === null,
    );
    expect(owners.map((m: { userId: string }) => m.userId)).toEqual([ownerId]);
    expect((await (await owner.get(`${base}/invites`)).json()).invites).toHaveLength(1);
  });

  test('a person outside the group can neither see nor change it', async ({ playwright }) => {
    const { outsider, groupId, ownerId, outsiderId, token } = await setup(playwright);
    const base = `/api/groups/${groupId}`;

    // Whether the group exists is not revealed: it looks the same as one that does not.
    await expectError(await outsider.get(`${base}/invites`), 404, 'not_found');
    await expectError(await outsider.post(`${base}/invites`, { data: {} }), 404, 'not_found');
    await expectError(await outsider.delete(`${base}/invites`), 404, 'not_found');
    await expectError(await outsider.patch(base, { data: { name: 'Mine now' } }), 404, 'not_found');
    await expectError(await outsider.delete(`${base}/members/${ownerId}`), 404, 'not_a_member');

    await expectError(
      await outsider.post(`${base}/placeholders`, { data: { name: 'Ghost' } }),
      403,
      'forbidden',
    );
    await expectError(
      await outsider.post(`${base}/transfer`, { data: { userId: outsiderId } }),
      403,
      'forbidden',
    );
    await expectError(
      await outsider.post(`${base}/members/${outsiderId}/reinstate`),
      403,
      'forbidden',
    );
    await expectError(await outsider.delete(base), 403, 'forbidden');

    const nowhere = `/api/groups/${missingId()}`;
    await expectError(await outsider.get(`${nowhere}/invites`), 404, 'not_found');
    await expectError(await outsider.delete(nowhere), 403, 'forbidden');

    // The invite token alone is what lets someone in; a wrong one does not, and a right one is
    // not wasted by the attempts above.
    await expectError(
      await outsider.post('/api/invites/accept', { data: { token: 'A'.repeat(43) } }),
      404,
      'invite_invalid',
    );
    const joined = await outsider.post('/api/invites/accept', { data: { token } });
    expect(joined.status()).toBe(200);
  });

  test('the owner cannot leave, hand the group to nobody, or to someone who cannot own it', async ({
    playwright,
  }) => {
    const { owner, groupId, ownerId, outsiderId } = await setup(playwright);
    const base = `/api/groups/${groupId}`;
    const sam = await (await owner.post(`${base}/placeholders`, { data: { name: 'Sam' } })).json();

    await expectError(await owner.delete(`${base}/members/${ownerId}`), 409, 'owner_cannot_leave');
    await expectError(
      await owner.post(`${base}/transfer`, { data: { userId: ownerId } }),
      409,
      'invalid_target',
    );
    await expectError(
      await owner.post(`${base}/transfer`, { data: { userId: sam.userId } }),
      409,
      'invalid_target',
    );
    await expectError(
      await owner.post(`${base}/transfer`, { data: { userId: outsiderId } }),
      404,
      'not_found',
    );
    await expectError(
      await owner.post(`${base}/transfer`, { data: { userId: missingId() } }),
      404,
      'not_found',
    );
    // Still the owner after all of that.
    expect((await owner.post(`${base}/invites`, { data: {} })).status()).toBe(201);
  });

  test('removing someone who is not in the group, or bringing back someone who never left, is refused', async ({
    playwright,
  }) => {
    const { owner, member, groupId, memberId, outsiderId } = await setup(playwright);
    const base = `/api/groups/${groupId}`;

    await expectError(await owner.delete(`${base}/members/${outsiderId}`), 404, 'not_found');
    await expectError(await owner.post(`${base}/members/${memberId}/reinstate`), 404, 'not_found');

    // After a member leaves they are no longer part of it, and cannot leave twice.
    expect((await member.delete(`${base}/members/${memberId}`)).status()).toBe(200);
    await expectError(await member.delete(`${base}/members/${memberId}`), 404, 'not_a_member');
    await expectError(await member.get(`${base}/invites`), 404, 'not_found');
  });
});

test.describe('what the server will not accept', () => {
  test('refuses group requests that are malformed', async ({ playwright }) => {
    const { owner, groupId } = await setup(playwright);
    const bad: unknown[] = [
      {},
      { name: '' },
      { name: '    ' },
      { name: 'g'.repeat(61) },
      { name: 7 },
      { id: 'not-a-uuid', name: 'Fine name' },
    ];
    for (const data of bad) {
      await expectError(await owner.post('/api/groups', { data }), 400, 'invalid_request');
    }
    await expectError(
      await owner.patch(`/api/groups/${groupId}`, { data: { name: '' } }),
      400,
      'invalid_request',
    );
    await expectError(
      await owner.patch(`/api/groups/${groupId}`, { data: { name: 'g'.repeat(61) } }),
      400,
      'invalid_request',
    );
    for (const name of ['', '   ', 'n'.repeat(101)]) {
      await expectError(
        await owner.post(`/api/groups/${groupId}/placeholders`, { data: { name } }),
        400,
        'invalid_request',
      );
    }
    await expectError(
      await owner.post(`/api/groups/${groupId}/transfer`, { data: { userId: 'someone' } }),
      400,
      'invalid_request',
    );

    // An id that is not an id.
    await expectError(
      await owner.patch('/api/groups/not-a-uuid', { data: { name: 'x' } }),
      400,
      'invalid_request',
    );
    await expectError(await owner.get('/api/groups/not-a-uuid/invites'), 400, 'invalid_request');
    await expectError(
      await owner.delete(`/api/groups/${groupId}/members/not-a-uuid`),
      400,
      'invalid_request',
    );
    await expectError(
      await owner.delete(`/api/groups/${groupId}/invites/not-a-uuid`),
      400,
      'invalid_request',
    );
  });

  test('a group id that is taken by someone else cannot be claimed, but a retry of your own is fine', async ({
    playwright,
  }) => {
    const first = await signedInApi(playwright, uniqueEmail('first'));
    const second = await signedInApi(playwright, uniqueEmail('second'));
    const id = missingId();

    const created = await first.post('/api/groups', { data: { id, name: 'Mine' } });
    expect(created.status()).toBe(201);
    // The device did not hear back and tries again with the same id: same group, not a second one.
    const retried = await first.post('/api/groups', { data: { id, name: 'Mine' } });
    expect(retried.status()).toBe(201);
    expect(await retried.json()).toEqual({ groupId: id });

    await expectError(
      await second.post('/api/groups', { data: { id, name: 'Stolen' } }),
      409,
      'id_taken',
    );
  });

  test('refuses invites that are malformed, expired, stopped or made up', async ({
    playwright,
  }) => {
    const { owner, outsider, groupId, token } = await setup(playwright);

    for (const data of [{}, { token: 5 }, { token: 'short' }, { token: 'x'.repeat(129) }]) {
      await expectError(
        await outsider.post('/api/invites/accept', { data }),
        400,
        'invalid_request',
      );
    }
    await expectError(
      await outsider.post('/api/invites/accept', { data: { token: 'B'.repeat(43) } }),
      404,
      'invite_invalid',
    );

    // The preview needs no sign-in and says nothing about a link that is not good.
    const anonymous = await playwright.request.newContext({ baseURL: ORIGIN });
    const preview = (t: string) =>
      anonymous.get(`/api/invites/preview?token=${encodeURIComponent(t)}`).then((r) => r.json());
    expect(await preview(token)).toEqual({
      valid: true,
      groupName: 'API group',
      invitedBy: 'Owner',
    });
    expect(await preview('short')).toEqual({ valid: false });
    expect(await preview('x'.repeat(200))).toEqual({ valid: false });
    expect(await preview('C'.repeat(43))).toEqual({ valid: false });
    expect(await anonymous.get('/api/invites/preview').then((r) => r.json())).toEqual({
      valid: false,
    });

    // Once the owner stops the links, the one that worked no longer does.
    expect((await owner.delete(`/api/groups/${groupId}/invites`)).status()).toBe(200);
    expect(await preview(token)).toEqual({ valid: false });
    await expectError(
      await outsider.post('/api/invites/accept', { data: { token } }),
      404,
      'invite_invalid',
    );
    await anonymous.dispose();
  });

  test('refuses sync requests that are malformed', async ({ playwright }) => {
    const { owner, groupId, ownerId } = await setup(playwright);
    const mutation = () => expenseMutation(groupId, ownerId);

    const badPushes: { why: string; data: unknown }[] = [
      { why: 'no body', data: {} },
      { why: 'no mutations', data: { mutations: [] } },
      { why: 'more than ten', data: { mutations: Array.from({ length: 11 }, mutation) } },
      {
        why: 'an entity that does not exist',
        data: { mutations: [{ ...mutation(), entity: 'wallet' }] },
      },
      {
        why: 'an expense whose payments do not add up',
        data: {
          mutations: [
            {
              ...mutation(),
              data: { ...mutation().data, payers: [{ userId: ownerId, amountMinor: 1 }] },
            },
          ],
        },
      },
      {
        why: 'a negative amount',
        data: { mutations: [{ ...mutation(), data: { ...mutation().data, amountMinor: -5 } }] },
      },
      {
        why: 'a date that does not exist',
        data: {
          mutations: [{ ...mutation(), data: { ...mutation().data, occurredOn: '2026-02-30' } }],
        },
      },
      {
        why: 'a note that is too long',
        data: {
          mutations: [{ ...mutation(), data: { ...mutation().data, note: 'n'.repeat(201) } }],
        },
      },
    ];
    for (const { why, data } of badPushes) {
      await expectError(await owner.post('/api/sync/push', { data }), 400, 'invalid_request', why);
    }
    // A repeated id, built properly.
    const same = mutation();
    await expectError(
      await owner.post('/api/sync/push', { data: { mutations: [same, same] } }),
      400,
      'invalid_request',
    );

    for (const query of [
      'since=-1',
      'since=abc',
      'limit=0',
      'limit=201',
      'limit=lots',
      'groupId=not-a-uuid',
    ]) {
      await expectError(await owner.get(`/api/sync/pull?${query}`), 400, 'invalid_request');
    }
    const fine = await owner.get('/api/sync/pull?since=0&limit=200');
    expect(fine.status()).toBe(200);
  });

  test('answers an unknown address or the wrong method with a plain "not found"', async ({
    playwright,
  }) => {
    const { owner } = await setup(playwright);
    await expectError(await owner.get('/api/nothing-here'), 404, 'not_found');
    await expectError(await owner.delete('/api/me'), 404, 'not_found');
    await expectError(await owner.post('/api/healthz'), 404, 'not_found');
    const health = await owner.get('/api/healthz');
    expect(await health.json()).toMatchObject({ status: 'ok', db: 'ok' });
  });
});

test.describe('who may read and write a group’s data', () => {
  test('an outsider cannot pull it, and their pushes into it are rejected', async ({
    playwright,
  }) => {
    const { owner, outsider, groupId, ownerId, outsiderId } = await setup(playwright);
    const expenseId = missingId();
    const pushed = await owner.post('/api/sync/push', {
      data: { mutations: [expenseMutation(groupId, ownerId, expenseId)] },
    });
    expect((await pushed.json()).results[0].status).toBe('applied');

    // Asking for the group by id.
    await expectError(await outsider.get(`/api/sync/pull?groupId=${groupId}`), 403, 'not_a_member');
    // Asking for everything: it is simply not there.
    const everything = await (await outsider.get('/api/sync/pull')).json();
    expect(everything.groups.map((g: { id: string }) => g.id)).not.toContain(groupId);
    expect(everything.expenses.map((e: { id: string }) => e.id)).not.toContain(expenseId);
    expect(everything.members.map((m: { groupId: string }) => m.groupId)).not.toContain(groupId);

    // Writing into it: an expense, a change to the owner's expense, and a delete.
    const attempts = [
      expenseMutation(groupId, outsiderId),
      {
        ...expenseMutation(groupId, outsiderId, expenseId),
        baseVersion: 1,
        data: { ...expenseMutation(groupId, outsiderId, expenseId).data, note: 'Edited' },
      },
      {
        mutationId: missingId(),
        baseVersion: 1,
        createdAt: Date.now(),
        op: 'delete',
        entity: 'expense',
        id: expenseId,
        groupId,
      },
    ];
    for (const attempt of attempts) {
      const response = await outsider.post('/api/sync/push', { data: { mutations: [attempt] } });
      expect(response.status()).toBe(200);
      const [result] = (await response.json()).results;
      expect(result, JSON.stringify(attempt.op)).toMatchObject({
        status: 'rejected',
        reason: 'not_a_member',
      });
    }

    // The owner's expense is untouched.
    const mine = await (await owner.get('/api/sync/pull')).json();
    const expense = mine.expenses.find((e: { id: string }) => e.id === expenseId);
    expect(expense).toMatchObject({ note: 'API expense', deletedAt: null });
  });

  test('someone who has been removed loses access straight away', async ({ playwright }) => {
    const { owner, member, groupId, memberId } = await setup(playwright);
    const first = await member.post('/api/sync/push', {
      data: { mutations: [expenseMutation(groupId, memberId)] },
    });
    expect((await first.json()).results[0].status).toBe('applied');
    expect((await member.get(`/api/sync/pull?groupId=${groupId}`)).status()).toBe(200);

    expect((await owner.delete(`/api/groups/${groupId}/members/${memberId}`)).status()).toBe(200);

    await expectError(await member.get(`/api/sync/pull?groupId=${groupId}`), 403, 'not_a_member');
    const after = await member.post('/api/sync/push', {
      data: { mutations: [expenseMutation(groupId, memberId)] },
    });
    expect((await after.json()).results[0]).toMatchObject({
      status: 'rejected',
      reason: 'not_a_member',
    });

    // An invite link cannot undo a removal either, only the owner can.
    const invite = await (await owner.post(`/api/groups/${groupId}/invites`, { data: {} })).json();
    await expectError(
      await member.post('/api/invites/accept', { data: { token: invite.token } }),
      403,
      'removed',
    );
    expect(
      (await owner.post(`/api/groups/${groupId}/members/${memberId}/reinstate`)).status(),
    ).toBe(200);
    expect((await member.get(`/api/sync/pull?groupId=${groupId}`)).status()).toBe(200);
  });

  test('an expense cannot name someone who is not in the group, or live in another group', async ({
    playwright,
  }) => {
    const { owner, groupId, ownerId, outsiderId } = await setup(playwright);
    const other = await (await owner.post('/api/groups', { data: { name: 'Other' } })).json();

    const stranger = expenseMutation(groupId, ownerId);
    stranger.data.shares = [{ userId: outsiderId, amountMinor: 10_000 }];
    const named = await owner.post('/api/sync/push', { data: { mutations: [stranger] } });
    expect((await named.json()).results[0]).toMatchObject({
      status: 'rejected',
      reason: 'invalid_reference',
    });

    // Created in one group, then "edited" to claim it belongs to another.
    const id = missingId();
    const created = await owner.post('/api/sync/push', {
      data: { mutations: [expenseMutation(groupId, ownerId, id)] },
    });
    expect((await created.json()).results[0].status).toBe('applied');
    const moved = {
      ...expenseMutation(other.groupId, ownerId, id),
      baseVersion: 1,
    };
    const result = (
      await (await owner.post('/api/sync/push', { data: { mutations: [moved] } })).json()
    ).results[0];
    expect(result).toMatchObject({ status: 'rejected', reason: 'group_mismatch' });
  });
});

test.describe('every address that needs a sign-in asks for one', () => {
  test('answers 401 to everything, whatever is sent', async ({ playwright }) => {
    const anonymous = await playwright.request.newContext({
      baseURL: ORIGIN,
      extraHTTPHeaders: { origin: ORIGIN },
    });
    const id = missingId();
    const calls: [string, string][] = [
      ['GET', '/api/me'],
      ['GET', '/api/sync/pull'],
      ['POST', '/api/sync/push'],
      ['POST', '/api/groups'],
      ['PATCH', `/api/groups/${id}`],
      ['DELETE', `/api/groups/${id}`],
      ['GET', `/api/groups/${id}/invites`],
      ['POST', `/api/groups/${id}/invites`],
      ['DELETE', `/api/groups/${id}/invites`],
      ['DELETE', `/api/groups/${id}/invites/${missingId()}`],
      ['POST', `/api/groups/${id}/placeholders`],
      ['PATCH', `/api/groups/${id}/placeholders/${missingId()}`],
      ['POST', `/api/groups/${id}/transfer`],
      ['DELETE', `/api/groups/${id}/members/${missingId()}`],
      ['POST', `/api/groups/${id}/members/${missingId()}/reinstate`],
      ['POST', '/api/invites/accept'],
    ];
    for (const [method, path] of calls) {
      const response = await anonymous.fetch(path, { method, data: {} });
      expect(response.status(), `${method} ${path}`).toBe(401);
      expect(await response.json()).toEqual({ error: 'unauthorized' });
    }
    await anonymous.dispose();
  });
});

test.describe('the live connection', () => {
  const upgrade = { Upgrade: 'websocket', Connection: 'Upgrade' };

  test('is refused unless it is a WebSocket from our origin, with a good id, by a signed-in person', async ({
    playwright,
  }) => {
    const signedIn = await signedInApi(playwright, uniqueEmail('live-api'));
    const anonymous = await playwright.request.newContext({ baseURL: ORIGIN });
    const id = 'a-device-connection-id';

    // An ordinary request to the WebSocket address.
    await expectError(await signedIn.get(`/api/live?id=${id}`), 426, 'expected_websocket');
    // Asked to upgrade, but from another site's page.
    for (const origin of ['https://evil.example', 'null', 'http://localhost:8788']) {
      await expectError(
        await signedIn.get(`/api/live?id=${id}`, { headers: { ...upgrade, origin } }),
        403,
        'bad_origin',
        origin,
      );
    }
    // Our origin, but the id is not an id.
    for (const bad of ['', 'short', 'has spaces in it!', 'x'.repeat(65)]) {
      await expectError(
        await signedIn.get(`/api/live?id=${encodeURIComponent(bad)}`, { headers: upgrade }),
        400,
        'invalid_request',
      );
    }
    // Our origin and a good id, but nobody is signed in.
    await expectError(
      await anonymous.get(`/api/live?id=${id}`, { headers: { ...upgrade, origin: ORIGIN } }),
      401,
      'unauthorized',
    );
    await signedIn.dispose();
    await anonymous.dispose();
  });
});

test.describe('limits', () => {
  test('a group holds at most 50 people, and a full group turns a new joiner away', async ({
    playwright,
  }) => {
    const { owner, outsider, groupId, token } = await setup(playwright);
    const base = `/api/groups/${groupId}`;

    // The owner and the member are already in; add people without the app until it is full.
    let added = 0;
    for (; added < 60; added++) {
      const response = await owner.post(`${base}/placeholders`, {
        data: { name: `Guest ${added}` },
      });
      if (response.status() !== 201) {
        await expectError(response, 409, 'group_full');
        break;
      }
    }
    expect(added).toBe(48); // 2 people + 48 guests = 50

    await expectError(
      await outsider.post('/api/invites/accept', { data: { token } }),
      409,
      'group_full',
    );
  });

  test('a person is in at most 30 groups, and the app says so', async ({ page }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('many-groups'));

    // Everyone's own ledger counts as one of the 30.
    const made = await createGroupsUntilRefused(page);
    expect(made).toBe(29);

    await page.goto('/groups');
    await page.getByRole('button', { name: 'New' }).click();
    await page.getByRole('dialog').getByLabel('Group name').fill('One too many');
    await page.getByRole('dialog').getByRole('button', { name: 'Create group' }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toHaveText(
      'You’re in the maximum number of groups.',
    );
  });
});

/** Creates groups through the API until the server refuses; returns how many it made. */
async function createGroupsUntilRefused(page: Page): Promise<number> {
  let made = 0;
  for (; made < 40; made++) {
    const response = await page.request.post('/api/groups', {
      data: { name: `Group ${made + 1}` },
      headers: { origin: ORIGIN },
    });
    if (response.status() !== 201) {
      expect(response.status()).toBe(409);
      expect(await response.json()).toEqual({ error: 'too_many_groups' });
      break;
    }
  }
  return made;
}
