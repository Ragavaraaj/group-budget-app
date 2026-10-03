import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { addDays, toIndiaDate, uuidv7 } from '@budget/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import worker, { runScheduled } from '../../../src';
import { MAX_SOCKETS_PER_USER } from '../../../src/modules/live/hub';
import { settleNotifications } from '../../../src/modules/live/notify';
import { ORIGIN, resetDb } from '../../support/helpers';
import {
  createSharedGroup,
  expenseData,
  join,
  makeInvite,
  type Person,
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

/** An open live connection with everything it has been sent. */
interface Connection {
  socket: WebSocket;
  messages: string[];
  closed: Promise<{ code: number }>;
}

async function connectRaw(
  person: Person,
  options: { id?: string; origin?: string | null; cookies?: boolean; upgrade?: boolean } = {},
): Promise<Response> {
  const headers = new Headers();
  if (options.upgrade !== false) headers.set('Upgrade', 'websocket');
  if (options.origin !== null) headers.set('Origin', options.origin ?? ORIGIN);
  if (options.cookies !== false) {
    headers.set('Cookie', [...person.client.cookies].map(([k, v]) => `${k}=${v}`).join('; '));
  }
  const ctx = createExecutionContext();
  const response = await worker.fetch?.(
    new Request(`${ORIGIN}/api/live?id=${options.id ?? uuidv7()}`, { headers }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response as Response;
}

async function connect(person: Person, id: string = uuidv7()): Promise<Connection> {
  const response = await connectRaw(person, { id });
  expect(response.status).toBe(101);
  const socket = response.webSocket as WebSocket;
  socket.accept();
  const messages: string[] = [];
  socket.addEventListener('message', (event) => {
    messages.push(String(event.data));
  });
  const closed = new Promise<{ code: number }>((resolve) =>
    socket.addEventListener('close', (event) => {
      resolve({ code: event.code });
    }),
  );
  return { socket, messages, closed };
}

const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(condition: () => boolean, what: string) {
  for (let i = 0; i < 60 && !condition(); i++) await settle(25);
  expect(condition(), what).toBe(true);
}

const pushExpense = (by: Person, groupId: string, liveId?: string) =>
  by.client.post(
    '/api/sync/push',
    {
      mutations: [upsert('expense', expenseData(groupId, by.id))].map((m) => m),
    },
    liveId ? { headers: { 'x-live-id': liveId } } : undefined,
  );

async function sharedGroup() {
  const groupId = await createSharedGroup(alice);
  await join(bob, (await makeInvite(alice, groupId)).token);
  // Creating the group and joining it tell people too, after their responses. Let those be
  // delivered (to nobody: nobody is connected yet) so they can't be mistaken for what a test checks.
  await settleNotifications();
  return groupId;
}

describe('connecting', () => {
  it('needs a signed-in person, our own origin, a WebSocket request and a connection id', async () => {
    const signedOut = await connectRaw(alice, { cookies: false });
    expect(signedOut.status).toBe(401);

    expect((await connectRaw(alice, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await connectRaw(alice, { origin: null })).status).toBe(403);
    expect((await connectRaw(alice, { upgrade: false })).status).toBe(426);
    expect((await connectRaw(alice, { id: 'x' })).status).toBe(400);
    expect((await connectRaw(alice, { id: 'has spaces and !' })).status).toBe(400);
  });

  it('accepts a signed-in person and answers a keep-alive ping', async () => {
    const connection = await connect(alice);
    connection.socket.send('ping');
    await until(() => connection.messages.includes('pong'), 'a pong');
    connection.socket.close(1000, 'done');
  });
});

describe('telling people something changed', () => {
  it('wakes a group-mate when someone pushes, with a message that carries no data', async () => {
    const groupId = await sharedGroup();
    const bobsApp = await connect(bob);

    await pushExpense(alice, groupId);
    await until(() => bobsApp.messages.length > 0, 'a message for Bob');
    expect(bobsApp.messages).toEqual(['{"type":"changed"}']);
    bobsApp.socket.close(1000, 'done');
  });

  it("does not wake the device that pushed, but does wake that person's other devices", async () => {
    const groupId = await sharedGroup();
    const sender = await connect(alice, 'sender-device-1');
    const otherDevice = await connect(alice, 'other-device-2');

    await pushExpense(alice, groupId, 'sender-device-1');
    await until(() => otherDevice.messages.length > 0, 'a message for the other device');
    await settleNotifications();
    await settle();
    expect(sender.messages).toEqual([]);
    sender.socket.close(1000, 'done');
    otherDevice.socket.close(1000, 'done');
  });

  it('tells nobody outside the group', async () => {
    const groupId = await sharedGroup();
    const outsider = await connect(carol);
    const bobsApp = await connect(bob);

    await pushExpense(alice, groupId);
    await until(() => bobsApp.messages.length > 0, 'a message for Bob');
    await settleNotifications();
    await settle();
    expect(outsider.messages).toEqual([]);
    outsider.socket.close(1000, 'done');
    bobsApp.socket.close(1000, 'done');
  });

  it('does not tell anyone when a push changes nothing', async () => {
    const groupId = await sharedGroup();
    const bobsApp = await connect(bob);
    const baseline = bobsApp.messages.length;

    const mutation = upsert('expense', expenseData(groupId, alice.id));
    await alice.client.post('/api/sync/push', { mutations: [mutation] });
    await until(() => bobsApp.messages.length === baseline + 1, 'one message for the push');

    // The same push again is a duplicate: nothing was written, so there is nothing to tell.
    await alice.client.post('/api/sync/push', { mutations: [mutation] });
    await settleNotifications();
    await settle();
    expect(bobsApp.messages).toHaveLength(baseline + 1);
    bobsApp.socket.close(1000, 'done');
  });

  it('tells members about group changes: someone joining, a rename, a hand-over', async () => {
    const groupId = await createSharedGroup(alice);
    await settleNotifications();
    const alicesApp = await connect(alice);

    const link = await makeInvite(alice, groupId);
    await join(bob, link.token);
    await until(() => alicesApp.messages.length >= 1, 'a message when Bob joined');

    const before = alicesApp.messages.length;
    await alice.client.request(`/api/groups/${groupId}`, {
      method: 'PATCH',
      json: { name: 'New' },
    });
    await until(() => alicesApp.messages.length > before, 'a message for the rename');

    const afterRename = alicesApp.messages.length;
    await alice.client.post(`/api/groups/${groupId}/transfer`, { userId: bob.id });
    await until(() => alicesApp.messages.length > afterRename, 'a message for the hand-over');
    alicesApp.socket.close(1000, 'done');
  });

  it('tells the person who was removed, so their app drops the group at once', async () => {
    const groupId = await sharedGroup();
    const bobsApp = await connect(bob);

    await alice.client.request(`/api/groups/${groupId}/members/${bob.id}`, { method: 'DELETE' });
    await until(() => bobsApp.messages.length > 0, 'a message for the removed person');
    bobsApp.socket.close(1000, 'done');
  });

  it('tells everyone when a group is deleted', async () => {
    const groupId = await sharedGroup();
    const alicesApp = await connect(alice);
    const bobsApp = await connect(bob);

    await alice.client.request(`/api/groups/${groupId}`, { method: 'DELETE' });
    await until(() => alicesApp.messages.length > 0 && bobsApp.messages.length > 0, 'both told');
    alicesApp.socket.close(1000, 'done');
    bobsApp.socket.close(1000, 'done');
  });

  it('tells the group when the scheduled job creates an expense', async () => {
    const groupId = await sharedGroup();
    const { occurredOn: _day, ...template } = expenseData(groupId, alice.id, {
      shares: [{ userId: alice.id, amountMinor: 10_000 }],
    });
    await push(alice, [
      upsert('recurring', {
        ...template,
        frequency: 'monthly',
        startOn: toIndiaDate(new Date()),
        endOn: null,
        active: true,
      }),
    ]);
    const bobsApp = await connect(bob);

    await runScheduled(env, Date.now());
    await until(() => bobsApp.messages.length > 0, 'a message for Bob');
    bobsApp.socket.close(1000, 'done');
    void addDays;
  });
});

describe('connections', () => {
  it('keeps only the newest few connections of one person', async () => {
    const connections: Connection[] = [];
    for (let i = 0; i < MAX_SOCKETS_PER_USER + 2; i++) connections.push(await connect(alice));

    const closed = await Promise.all(connections.slice(0, 2).map((c) => c.closed));
    expect(closed.every((c) => c.code === 1008)).toBe(true);
    for (const connection of connections.slice(2)) connection.socket.close(1000, 'done');
  });

  it('copes with notifying someone who is not connected, and with a closed connection', async () => {
    const groupId = await sharedGroup();
    const gone = await connect(bob);
    gone.socket.close(1000, 'bye');
    await settle();

    const response = await pushExpense(alice, groupId);
    expect(response.status).toBe(200);
    await settleNotifications(); // it runs after the response and must not break anything
  });
});
