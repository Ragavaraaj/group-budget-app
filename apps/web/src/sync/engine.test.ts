import { type Mutation, type PullResponse, uuidv7 } from '@budget/shared';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { BudgetDb, getMeta, setMeta } from '@/db/database';
import { deleteExpense, saveExpense } from '@/db/repo';
import type { Rejection } from '@/db/types';
import { NetworkError } from '@/lib/api';
import {
  categoryRow,
  emptyPull,
  expenseRow,
  FakeApi,
  groupRow,
  httpError,
  memberRow,
} from '@/test-helpers';
import { type Environment, SyncEngine, type SyncEvents } from './engine';

const ME = uuidv7();
const G = uuidv7();
let db: BudgetDb;
let online = true;
let visible = true;
let consoleError: MockInstance;
const environment: Environment = { isOnline: () => online, isVisible: () => visible };

beforeEach(async () => {
  online = true;
  visible = true;
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  db = new BudgetDb(`test-${uuidv7()}`);
  await db.open();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const engineFor = (api: FakeApi, events: SyncEvents = {}, extra: object = {}) =>
  new SyncEngine({ db, api, userId: ME, events, environment, ...extra });

const draft = (overrides: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  groupId: G,
  occurredOn: '2026-10-02',
  amountMinor: 5_000,
  categoryId: null,
  note: '',
  splitType: 'equal' as const,
  payers: [{ userId: ME, amountMinor: 5_000 }],
  shares: [{ userId: ME, amountMinor: 5_000 }],
  ...overrides,
});

const queueExpenses = async (n: number) => {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const data = draft({ note: `e${i}` });
    ids.push(data.id);
    await saveExpense(db, ME, data);
  }
  return ids;
};

describe('pushing', () => {
  it('sends queued changes oldest first, in requests of at most ten, and empties the queue', async () => {
    const ids = await queueExpenses(23);
    const api = new FakeApi();
    await engineFor(api).trigger();

    expect(api.pushes.map((p) => p.length)).toEqual([10, 10, 3]);
    const sent = api.pushes.flat().map((m) => (m.op === 'upsert' ? m.data.id : m.id));
    expect(sent).toEqual(ids);
    expect(await db.outbox.count()).toBe(0);
  });

  it('tells the server what each change builds on, and stores the version it answers with', async () => {
    const [id] = await queueExpenses(1);
    const api = new FakeApi((ms) =>
      ms.map((m) => ({ mutationId: m.mutationId, status: 'applied' as const, version: 4 })),
    );
    await engineFor(api).trigger();
    expect(api.pushes[0]?.[0]).toMatchObject({ op: 'upsert', baseVersion: null });
    expect((await db.expenses.get(id ?? ''))?.version).toBe(4);
  });

  it('treats a duplicate as done', async () => {
    await queueExpenses(1);
    const api = new FakeApi((ms) =>
      ms.map((m) => ({ mutationId: m.mutationId, status: 'duplicate' as const })),
    );
    await engineFor(api).trigger();
    expect(await db.outbox.count()).toBe(0);
  });

  it('sends a delete as a tombstone mutation, not as data', async () => {
    const [id] = await queueExpenses(1);
    await db.outbox.clear();
    await db.expenses.update(id ?? '', { version: 2, serverSeq: 9 });
    await deleteExpense(db, ME, id ?? '');
    const api = new FakeApi();
    await engineFor(api).trigger();
    expect(api.pushes[0]?.[0]).toMatchObject({
      op: 'delete',
      entity: 'expense',
      id,
      groupId: G,
      baseVersion: 2,
    });
    expect(api.pushes[0]?.[0]).not.toHaveProperty('data');
  });

  it('does not overwrite a row that has newer edits queued behind the one just sent', async () => {
    const [id] = await queueExpenses(1);
    const data = (await db.outbox.toArray())[0]?.data as ReturnType<typeof draft>;
    await saveExpense(db, ME, { ...data, note: 'second edit' }); // queued behind the first
    const api = new FakeApi((ms) =>
      ms.map((m) => ({ mutationId: m.mutationId, status: 'applied' as const, version: 1 })),
    );
    // Answer only the first request so the second edit is still queued when it is settled.
    let calls = 0;
    api.onPush = (ms) => {
      calls++;
      return ms.map((m) => ({
        mutationId: m.mutationId,
        status: 'applied' as const,
        version: calls,
      }));
    };
    await engineFor(api).trigger();
    expect(await db.outbox.count()).toBe(0);
    expect((await db.expenses.get(id ?? ''))?.note).toBe('second edit');
  });

  describe('when something goes wrong', () => {
    it('keeps everything queued and reports offline if the network drops', async () => {
      await queueExpenses(3);
      const api = new FakeApi(() => {
        throw new NetworkError();
      });
      const engine = engineFor(api);
      await engine.trigger();
      expect(engine.getSnapshot().state).toBe('offline');
      expect(await db.outbox.count()).toBe(3);
    });

    it('does not even try while offline, then catches up', async () => {
      await queueExpenses(2);
      const api = new FakeApi();
      const engine = engineFor(api);
      online = false;
      await engine.trigger();
      expect(api.pushes).toHaveLength(0);
      expect(engine.getSnapshot().state).toBe('offline');

      online = true;
      await engine.trigger();
      expect(await db.outbox.count()).toBe(0);
      expect(engine.getSnapshot().state).toBe('idle');
    });

    it('keeps the queue and shows an error on a server failure', async () => {
      await queueExpenses(1);
      const engine = engineFor(new FakeApi(() => Promise.reject(httpError(503))));
      await engine.trigger();
      expect(engine.getSnapshot().state).toBe('error');
      expect(await db.outbox.count()).toBe(1);
    });

    it('does not send the same request forever if the server answers nothing', async () => {
      await queueExpenses(2);
      const api = new FakeApi(() => []);
      const engine = engineFor(api);
      await engine.trigger();
      expect(api.pushes).toHaveLength(1); // one attempt, not an endless loop
      expect(engine.getSnapshot().state).toBe('error');
      expect(await db.outbox.count()).toBe(2); // nothing lost
    });

    it('stops and keeps the queue when the session has ended', async () => {
      await queueExpenses(2);
      const engine = engineFor(new FakeApi(() => Promise.reject(httpError(401))));
      await engine.trigger();
      expect(engine.getSnapshot().state).toBe('signed_out');
      expect(await db.outbox.count()).toBe(2); // waits for a new sign-in
    });

    it('says where it went wrong and why, and forgets it after a sync that works', async () => {
      await queueExpenses(1);
      const api = new FakeApi(() => Promise.reject(httpError(503)));
      const engine = engineFor(api);
      await engine.trigger();
      expect(engine.getSnapshot().failure).toMatchObject({
        step: 'sending changes',
        detail: 'HTTP 503',
      });

      api.onPush = (ms) =>
        ms.map((m) => ({ mutationId: m.mutationId, status: 'applied' as const }));
      await engine.trigger();
      expect(engine.getSnapshot().state).toBe('idle');
      expect(engine.getSnapshot().failure).toBeNull();

      api.onPull = () => {
        throw new TypeError('undefined is not a function');
      };
      await engine.trigger();
      expect(engine.getSnapshot().failure).toMatchObject({
        step: 'receiving changes',
        detail: 'TypeError: undefined is not a function',
      });
    });

    it('names the step that failed when a group cannot be loaded', async () => {
      await setMeta(db, `backfill:${G}`, 0);
      const engine = engineFor(
        new FakeApi(undefined, (q) => {
          if (q.groupId) throw httpError(500);
          return emptyPull();
        }),
      );
      await engine.trigger();
      expect(engine.getSnapshot().failure?.step).toBe('loading a group');
      expect(await db.meta.where('key').startsWith('backfill:').count()).toBe(1); // tried again later
    });

    it('still pulls, and loads a group just joined, when the push fails', async () => {
      await setMeta(db, 'cursor', 500);
      await queueExpenses(1);
      const api = new FakeApi(
        () => Promise.reject(httpError(500)),
        (q) =>
          q.groupId
            ? emptyPull({ cursor: 3, groups: [groupRow(G, ME)] })
            : emptyPull({ cursor: 520, members: [memberRow(G, ME, { serverSeq: 510 })] }),
      );
      const engine = engineFor(api);
      await engine.trigger();

      expect(await db.groups.get(G)).toBeDefined();
      expect(await getMeta(db, 'cursor')).toBe(520);
      expect(await db.outbox.count()).toBe(1); // still waiting to be sent
      // The failed push is still reported: nothing is hidden because the rest worked.
      expect(engine.getSnapshot().state).toBe('error');
      expect(engine.getSnapshot().failure).toMatchObject({ step: 'sending changes' });
    });

    it('keeps both causes when the push fails and then the pull does too', async () => {
      await queueExpenses(1);
      const api = new FakeApi(
        () => Promise.reject(httpError(500)),
        () => {
          throw httpError(502);
        },
      );
      const engine = engineFor(api);
      await engine.trigger();

      expect(engine.getSnapshot().failure).toEqual({
        step: 'sending changes',
        detail: 'HTTP 500',
        also: { step: 'receiving changes', detail: 'HTTP 502' },
      });
      expect(consoleError).toHaveBeenCalledTimes(2); // both reach the console too
    });

    it('counts a push that failed with a falsy value as a failure, not a success', async () => {
      await queueExpenses(1);
      const engine = engineFor(new FakeApi(() => Promise.reject(undefined)));
      await engine.trigger();
      expect(engine.getSnapshot().state).toBe('error');
      expect(engine.getSnapshot().failure?.step).toBe('sending changes');
      expect(await db.outbox.count()).toBe(1);
    });

    it('drops the reason as soon as the state is no longer an error', async () => {
      await queueExpenses(1);
      const engine = engineFor(new FakeApi(() => Promise.reject(httpError(503))));
      await engine.trigger();
      expect(engine.getSnapshot().failure).not.toBeNull();

      online = false;
      await engine.trigger();
      expect(engine.getSnapshot().state).toBe('offline');
      expect(engine.getSnapshot().failure).toBeNull();
    });

    it('says whether everything the server had was received, apart from sending', async () => {
      const received = async (api: FakeApi) => {
        const engine = engineFor(api);
        await engine.trigger();
        return engine.getSnapshot();
      };
      await queueExpenses(1);
      // Only sending failed: the pull and the backfills still finished.
      expect(await received(new FakeApi(() => Promise.reject(httpError(500))))).toMatchObject({
        state: 'error',
        caughtUp: true,
      });
      // Receiving failed.
      expect(
        await received(
          new FakeApi(undefined, () => {
            throw httpError(500);
          }),
        ),
      ).toMatchObject({ state: 'error', caughtUp: false });
      // The group's row came, then its history did not: the group is only partly here.
      await setMeta(db, 'cursor', 5);
      let calls = 0;
      const partial = await received(
        new FakeApi(undefined, (q) => {
          if (!q.groupId) return emptyPull({ members: [memberRow(G, ME, { serverSeq: 6 })] });
          if (calls++ === 0)
            return emptyPull({ cursor: 3, hasMore: true, groups: [groupRow(G, ME)] });
          throw httpError(500);
        }),
      );
      expect(partial).toMatchObject({ state: 'error', caughtUp: false });
      expect(await db.groups.get(G)).toBeDefined(); // the row is here, so the row alone proves nothing
      expect(await db.meta.where('key').startsWith('backfill:').count()).toBe(1);

      // A clean sync catches up; being offline does not.
      expect(await received(new FakeApi())).toMatchObject({ state: 'idle', caughtUp: true });
      online = false;
      expect(await received(new FakeApi())).toMatchObject({ state: 'offline', caughtUp: false });
    });

    it('writes a failure that keeps repeating to the console once', async () => {
      const engine = engineFor(
        new FakeApi(undefined, () => {
          throw httpError(503);
        }),
      );
      await engine.trigger();
      await engine.trigger();
      await engine.trigger();
      expect(consoleError).toHaveBeenCalledTimes(1);
    });

    it('does not pull on after the session ended or the network went', async () => {
      await queueExpenses(1);
      const ended = new FakeApi(() => Promise.reject(httpError(401)));
      await engineFor(ended).trigger();
      expect(ended.pulls).toHaveLength(0);

      const gone = new FakeApi(() => {
        throw new NetworkError();
      });
      await engineFor(gone).trigger();
      expect(gone.pulls).toHaveLength(0);
    });

    it('sends nothing twice if a push succeeds but the pull then fails', async () => {
      await queueExpenses(1);
      const api = new FakeApi(undefined, () => {
        throw new NetworkError();
      });
      const engine = engineFor(api);
      await engine.trigger();
      expect(await db.outbox.count()).toBe(0);
      api.onPull = () => emptyPull();
      await engine.trigger();
      expect(api.pushes).toHaveLength(1);
    });
  });

  describe('after the server refuses a change', () => {
    const rejectAll = (ms: Mutation[]) =>
      ms.map((m) => ({
        mutationId: m.mutationId,
        status: 'rejected' as const,
        reason: 'invalid_reference' as const,
      }));

    it('removes a new row the server never accepted, so this device agrees with all the others', async () => {
      const [id] = await queueExpenses(1);
      const events: Rejection[][] = [];
      await engineFor(new FakeApi(rejectAll), { onRejected: (r) => events.push(r) }).trigger();

      expect(await db.expenses.get(id ?? '')).toBeUndefined(); // gone from totals, lists and exports
      expect(await db.outbox.count()).toBe(0);
      expect(events[0]?.[0]).toMatchObject({ entityId: id, discarded: true });
      expect((await getMeta<Rejection[]>(db, 'rejections'))?.[0]?.discarded).toBe(true);
    });

    it('judges a row once, after everything queued for it was refused', async () => {
      const data = draft();
      await saveExpense(db, ME, data);
      await saveExpense(db, ME, { ...data, note: 'edited before the first sync' });
      await engineFor(new FakeApi(rejectAll)).trigger();
      expect(await db.expenses.get(data.id)).toBeUndefined();
    });

    it('puts a refused edit of an accepted row back to the server’s version', async () => {
      const server = expenseRow(G, ME, { note: 'what the server has', version: 3, serverSeq: 40 });
      await db.expenses.put(server);
      await saveExpense(db, ME, {
        id: server.id,
        groupId: G,
        occurredOn: server.occurredOn,
        amountMinor: server.amountMinor,
        categoryId: null,
        note: 'an edit the server refuses',
        splitType: 'equal',
        payers: server.payers,
        shares: server.shares,
      });
      expect((await db.expenses.get(server.id))?.note).toBe('an edit the server refuses');

      const api = new FakeApi(rejectAll, (q) =>
        q.groupId === G ? emptyPull({ cursor: 40, expenses: [server] }) : emptyPull(),
      );
      await engineFor(api).trigger();

      expect((await db.expenses.get(server.id))?.note).toBe('what the server has');
      expect(api.pulls.some((p) => p.groupId === G)).toBe(true); // re-fetched the group
      expect(await db.meta.where('key').startsWith('backfill:').count()).toBe(0); // and finished
    });

    it('brings a row back when a refused delete had hidden it', async () => {
      const server = expenseRow(G, ME, { version: 2, serverSeq: 12 });
      await db.expenses.put(server);
      await deleteExpense(db, ME, server.id);
      expect((await db.expenses.get(server.id))?.deletedAt).not.toBeNull();

      const api = new FakeApi(rejectAll, (q) =>
        q.groupId === G ? emptyPull({ cursor: 12, expenses: [server] }) : emptyPull(),
      );
      await engineFor(api).trigger();
      expect((await db.expenses.get(server.id))?.deletedAt).toBeNull();
    });
  });

  describe('rejections and conflicts', () => {
    it('drops a rejected change, remembers why, and reports it', async () => {
      await queueExpenses(2);
      const rejected: Rejection[][] = [];
      const api = new FakeApi((ms) => [
        { mutationId: ms[0]?.mutationId ?? '', status: 'rejected', reason: 'not_a_member' },
        { mutationId: ms[1]?.mutationId ?? '', status: 'applied', version: 1 },
      ]);
      await engineFor(api, { onRejected: (r) => rejected.push(r) }).trigger();

      expect(await db.outbox.count()).toBe(0);
      const stored = await getMeta<Rejection[]>(db, 'rejections');
      expect(stored).toEqual([
        expect.objectContaining({ entity: 'expense', op: 'upsert', reason: 'not_a_member' }),
      ]);
      expect(rejected).toHaveLength(1);
    });

    it('reports an edit that was applied but made from an out-of-date copy', async () => {
      await queueExpenses(2);
      const onConflicts = vi.fn();
      const api = new FakeApi((ms) =>
        ms.map((m, i) => ({
          mutationId: m.mutationId,
          status: 'applied' as const,
          version: 2,
          ...(i === 0 ? { conflict: true } : {}),
        })),
      );
      await engineFor(api, { onConflicts }).trigger();
      expect(onConflicts).toHaveBeenCalledWith(1);
    });

    it('finds the one malformed change in a request the server refuses, and sends the rest', async () => {
      const ids = await queueExpenses(4);
      const poison = ids[2];
      const api = new FakeApi((ms) => {
        if (ms.some((m) => m.op === 'upsert' && m.data.id === poison)) throw httpError(400);
        return ms.map((m) => ({
          mutationId: m.mutationId,
          status: 'applied' as const,
          version: 1,
        }));
      });
      const engine = engineFor(api);
      await engine.trigger();

      expect(await db.outbox.count()).toBe(0);
      const stored = await getMeta<Rejection[]>(db, 'rejections');
      expect(stored).toHaveLength(1);
      expect(stored?.[0]).toMatchObject({ entityId: poison, reason: 'invalid' });
      expect(engine.getSnapshot().state).toBe('idle');
    });
  });
});

describe('pulling', () => {
  const page = (cursor: number, hasMore: boolean, n: number): PullResponse =>
    emptyPull({
      cursor,
      hasMore,
      expenses: Array.from({ length: n }, (_, i) =>
        expenseRow(G, ME, { serverSeq: cursor - n + i + 1 }),
      ),
    });

  it('follows the pages to the end, applying each, and remembers the cursor', async () => {
    const pages = [page(10, true, 10), page(20, true, 10), page(25, false, 5)];
    const api = new FakeApi(undefined, (q) => pages.shift() ?? emptyPull({ cursor: q.since }));
    await engineFor(api).trigger();

    expect(api.pulls.map((p) => p.since)).toEqual([0, 10, 20]);
    expect(await db.expenses.count()).toBe(25);
    expect(await getMeta(db, 'cursor')).toBe(25);
  });

  it('asks only for what is new next time', async () => {
    await setMeta(db, 'cursor', 77);
    const api = new FakeApi();
    await engineFor(api).trigger();
    expect(api.pulls[0]).toMatchObject({ since: 77 });
  });

  it('pushes before it pulls, so its own changes come straight back', async () => {
    await queueExpenses(1);
    const order: string[] = [];
    const api = new FakeApi(
      (ms) => {
        order.push('push');
        return ms.map((m) => ({
          mutationId: m.mutationId,
          status: 'applied' as const,
          version: 1,
        }));
      },
      () => {
        order.push('pull');
        return emptyPull();
      },
    );
    await engineFor(api).trigger();
    expect(order).toEqual(['push', 'pull']);
  });

  it('tells the person when they were removed from a group', async () => {
    await db.groups.put(groupRow(G, ME, { name: 'Goa trip' }));
    const onRemoved = vi.fn();
    const api = new FakeApi(undefined, () =>
      emptyPull({ cursor: 9, members: [memberRow(G, ME, { removedAt: 5, serverSeq: 9 })] }),
    );
    await engineFor(api, { onRemoved }).trigger();
    expect(onRemoved).toHaveBeenCalledWith('Goa trip');
    expect(await db.groups.get(G)).toBeUndefined();
  });
});

describe('backfilling a group joined later', () => {
  it('fetches the whole history of just that group, with its own cursor', async () => {
    await setMeta(db, 'cursor', 500);
    const history = (since: number): PullResponse =>
      since === 0
        ? emptyPull({
            cursor: 3,
            hasMore: true,
            groups: [groupRow(G, ME)],
            expenses: [expenseRow(G, ME, { serverSeq: 2 }), expenseRow(G, ME, { serverSeq: 3 })],
          })
        : emptyPull({
            cursor: 6,
            hasMore: false,
            expenses: [expenseRow(G, ME, { serverSeq: 6 })],
            categories: [categoryRow(G, ME, { serverSeq: 5 })],
          });

    const api = new FakeApi(undefined, (q) =>
      q.groupId
        ? history(q.since)
        : emptyPull({ cursor: 520, members: [memberRow(G, ME, { serverSeq: 510 })] }),
    );
    await engineFor(api).trigger();

    const backfills = api.pulls.filter((p) => p.groupId);
    expect(backfills.map((p) => [p.groupId, p.since])).toEqual([
      [G, 0],
      [G, 3],
    ]);
    expect(await db.expenses.where('groupId').equals(G).count()).toBe(3);
    expect(await db.categories.count()).toBe(1);
    expect(await getMeta(db, 'cursor')).toBe(520); // the global cursor is not disturbed
    expect(await db.meta.where('key').startsWith('backfill:').count()).toBe(0); // done
  });

  it('gives up quietly if the person is no longer a member', async () => {
    await setMeta(db, 'cursor', 5);
    await setMeta(db, `backfill:${G}`, 0);
    const api = new FakeApi(undefined, (q) => {
      if (q.groupId) throw httpError(403);
      return emptyPull();
    });
    const engine = engineFor(api);
    await engine.trigger();
    expect(engine.getSnapshot().state).toBe('idle');
    expect(await db.meta.where('key').startsWith('backfill:').count()).toBe(0);
  });

  it('resumes after an interruption instead of starting over', async () => {
    await setMeta(db, `backfill:${G}`, 40);
    const api = new FakeApi();
    await engineFor(api).trigger();
    expect(api.pulls.find((p) => p.groupId)).toMatchObject({ groupId: G, since: 40 });
  });
});

describe('scheduling', () => {
  it('runs one more sync after the current one if asked again meanwhile', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let pulls = 0;
    const api = new FakeApi(undefined, async () => {
      pulls++;
      if (pulls === 1) await gate;
      return emptyPull();
    });
    const engine = engineFor(api);
    const first = engine.trigger();
    const second = engine.trigger();
    const third = engine.trigger();
    release();
    await Promise.all([first, second, third]);
    expect(pulls).toBe(2); // not three: the extra requests were coalesced
  });

  it('notifies subscribers as the state changes', async () => {
    const engine = engineFor(new FakeApi());
    const seen: string[] = [];
    engine.subscribe(() => seen.push(engine.getSnapshot().state));
    await engine.trigger();
    expect(seen).toEqual(['syncing', 'idle']);
    expect(engine.getSnapshot().lastSyncedAt).not.toBeNull();
  });
});

describe('polling', () => {
  beforeEach(() => {
    // Only timeouts are faked: the in-memory IndexedDB schedules its own work and must keep running.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  });
  afterEach(() => vi.unstubAllGlobals());

  /** Lets pending promises and IndexedDB work finish (real macrotasks, not faked timers). */
  const flush = async () => {
    const immediate = (globalThis as unknown as { setImmediate: (callback: () => void) => void })
      .setImmediate;
    for (let i = 0; i < 30; i++) await new Promise<void>((resolve) => immediate(resolve));
  };
  const advance = async (ms: number) => {
    vi.advanceTimersByTime(ms);
    await flush();
  };
  /** `flush` for work that takes more turns of the fake database (a long queue). */
  const settle = async () => {
    for (let i = 0; i < 4; i++) await flush();
  };
  const advanceLong = async (ms: number) => {
    vi.advanceTimersByTime(ms);
    await settle();
  };
  const fire = async (target: unknown, type: string) => {
    (target as EventTarget).dispatchEvent(new Event(type));
    await flush();
  };

  it('polls every 30 seconds at first, then backs off while nothing changes, up to the cap', async () => {
    const api = new FakeApi();
    const engine = engineFor(api, {}, { pollMs: 30_000, maxPollMs: 120_000 });
    engine.start();
    await flush();
    expect(api.pulls).toHaveLength(1);

    await advance(29_000);
    expect(api.pulls).toHaveLength(1);
    await advance(1_000); // t = 30 s: first poll; nothing new, so the next wait is 60 s
    expect(api.pulls).toHaveLength(2);
    await advance(59_000);
    expect(api.pulls).toHaveLength(2);
    await advance(1_000); // t = 90 s
    expect(api.pulls).toHaveLength(3);

    await advance(119_000); // the wait is now at the 2-minute cap
    expect(api.pulls).toHaveLength(3);
    await advance(1_000); // t = 210 s
    expect(api.pulls).toHaveLength(4);
    await advance(120_000); // t = 330 s: still every 2 minutes, never longer
    expect(api.pulls).toHaveLength(5);
    engine.stop();
  });

  it('goes back to polling quickly as soon as there is news', async () => {
    let n = 0;
    const api = new FakeApi(undefined, () =>
      emptyPull({ expenses: n++ === 2 ? [expenseRow(G, ME)] : [] }),
    );
    const engine = engineFor(api, {}, { pollMs: 30_000, maxPollMs: 600_000 });
    engine.start();
    await flush(); // t = 0: sync 1, quiet
    await advance(30_000); // t = 30: sync 2, quiet → next wait 60 s
    await advance(60_000); // t = 90: sync 3 has news → next wait back to 30 s
    expect(api.pulls).toHaveLength(3);
    await advance(30_000);
    expect(api.pulls).toHaveLength(4);
    engine.stop();
  });

  it('with the live connection up, syncs on news at once and polls only at the slowest interval', async () => {
    const api = new FakeApi();
    const engine = engineFor(api, {}, { pollMs: 30_000, maxPollMs: 300_000 });
    engine.start();
    await flush();
    expect(api.pulls).toHaveLength(1);

    engine.setLive(true); // coming up is a moment to catch up
    await flush();
    expect(engine.getSnapshot().live).toBe(true);
    expect(api.pulls).toHaveLength(2);

    // No 30-second polling any more: the next safety-net poll is five minutes away.
    await advance(290_000);
    expect(api.pulls).toHaveLength(2);
    await advance(10_000);
    expect(api.pulls).toHaveLength(3);

    // News from the server syncs immediately.
    engine.onLiveNews();
    await flush();
    expect(api.pulls).toHaveLength(4);
    engine.stop();
  });

  it('when the live connection drops, polls at the normal pace again, after catching up once', async () => {
    const api = new FakeApi();
    const engine = engineFor(api, {}, { pollMs: 30_000, maxPollMs: 300_000 });
    engine.start();
    await flush();
    engine.setLive(true);
    await flush();
    const before = api.pulls.length;

    engine.setLive(false);
    await flush();
    expect(engine.getSnapshot().live).toBe(false);
    expect(api.pulls).toHaveLength(before + 1); // one catch-up for what was missed

    await advance(30_000);
    expect(api.pulls).toHaveLength(before + 2);
    engine.stop();
  });

  it('does not sync for a connection closed while the app is in the background', async () => {
    const api = new FakeApi();
    const engine = engineFor(api, {}, { pollMs: 30_000 });
    engine.start();
    await flush();
    engine.setLive(true);
    await flush();
    const before = api.pulls.length;

    visible = false;
    await fire(document, 'visibilitychange');
    engine.setLive(false); // the channel closing itself as the app is hidden
    await flush();
    expect(engine.getSnapshot().live).toBe(false);
    expect(api.pulls).toHaveLength(before);
    await advance(10 * 60_000);
    expect(api.pulls).toHaveLength(before); // and nothing polls while hidden

    visible = true;
    await fire(document, 'visibilitychange'); // coming back syncs, once
    expect(api.pulls).toHaveLength(before + 1);
    engine.stop();
  });

  it('does nothing when told about the connection after it has been stopped', async () => {
    const api = new FakeApi();
    const engine = engineFor(api);
    engine.start();
    await flush();
    engine.setLive(true);
    await flush();
    const before = api.pulls.length;

    engine.stop();
    engine.setLive(false); // what `live.stop()` does, if it runs second
    await flush();
    expect(api.pulls).toHaveLength(before);
  });

  it('ignores a repeated live state, so a flapping connection does not cause extra syncs', async () => {
    const api = new FakeApi();
    const engine = engineFor(api);
    engine.start();
    await flush();
    engine.setLive(true);
    await flush();
    const before = api.pulls.length;
    engine.setLive(true);
    engine.setLive(true);
    await flush();
    expect(api.pulls).toHaveLength(before);
    engine.stop();
  });

  it('stops polling while the app is hidden and syncs again when it comes back', async () => {
    const api = new FakeApi();
    const engine = engineFor(api, {}, { pollMs: 30_000 });
    engine.start();
    await flush();
    expect(api.pulls).toHaveLength(1);

    visible = false;
    await fire(document, 'visibilitychange');
    await advance(10 * 60_000);
    expect(api.pulls).toHaveLength(1);

    visible = true;
    await fire(document, 'visibilitychange');
    expect(api.pulls).toHaveLength(2);
    engine.stop();
  });

  it('syncs when the connection comes back, and straight after a local write', async () => {
    const api = new FakeApi();
    const engine = engineFor(api);
    engine.start();
    await flush();
    expect(api.pulls).toHaveLength(1);

    await fire(window, 'online');
    expect(api.pulls).toHaveLength(2);

    await saveExpense(db, ME, draft());
    await flush();
    expect(api.pushes).toHaveLength(1);
    engine.stop();
  });

  it('shows offline when the browser says so, without waiting for the next poll', async () => {
    const engine = engineFor(new FakeApi());
    engine.start();
    await flush();
    await fire(window, 'offline');
    expect(engine.getSnapshot().state).toBe('offline');
    engine.stop();
  });

  it('does not poll once the session has ended', async () => {
    const api = new FakeApi(undefined, () => {
      throw httpError(401);
    });
    const engine = engineFor(api);
    engine.start();
    await flush();
    await advance(10 * 60_000);
    expect(api.pulls).toHaveLength(1);
    engine.stop();
  });

  it('retries at the normal pace while a push keeps getting part of the way', async () => {
    await queueExpenses(25); // three requests: 10, 10 and 5
    let calls = 0;
    const api = new FakeApi((ms) => {
      if (++calls % 2 === 0) throw httpError(503); // every second request fails
      return ms.map((m) => ({ mutationId: m.mutationId, status: 'applied' as const, version: 1 }));
    });
    const engine = engineFor(api, {}, { pollMs: 30_000, maxPollMs: 240_000 });
    engine.start();
    await settle(); // twenty-five queued changes take a few turns of the fake database
    expect(calls).toBe(2);

    await advanceLong(30_000);
    expect(calls).toBe(4);
    // Each round got something through, so the wait does not double.
    await advanceLong(30_000);
    expect(calls).toBe(5);
    expect(await db.outbox.count()).toBe(0);

    // That last round sent its changes cleanly and had nothing to pull: sending is news too, so
    // the next two polls are still 30 s apart (a round with nothing at all would make it 60 s).
    const pulled = api.pulls.length;
    await advance(30_000);
    expect(api.pulls.length).toBe(pulled + 1);
    await advance(30_000);
    expect(api.pulls.length).toBe(pulled + 2);
    engine.stop();
  });

  it('backs off while the server answers none of the changes, as it does for any failure', async () => {
    await queueExpenses(2);
    const api = new FakeApi(() => []); // 200, but no answer for any change
    const engine = engineFor(api, {}, { pollMs: 30_000, maxPollMs: 240_000 });
    engine.start();
    await flush();
    expect(api.pushes).toHaveLength(1);
    expect(engine.getSnapshot().state).toBe('error');

    await advance(30_000);
    expect(api.pushes).toHaveLength(2);
    await advance(30_000); // 60 s in: the wait has doubled, so nothing yet
    expect(api.pushes).toHaveLength(2);
    await advance(30_000); // 90 s in
    expect(api.pushes).toHaveLength(3);
    expect(await db.outbox.count()).toBe(2); // nothing lost
    engine.stop();
  });

  it('keeps retrying, slowly, after errors', async () => {
    let fail = true;
    const api = new FakeApi(undefined, () => {
      if (fail) throw httpError(503);
      return emptyPull();
    });
    const engine = engineFor(api, {}, { pollMs: 30_000, maxPollMs: 120_000 });
    engine.start();
    await flush();
    expect(engine.getSnapshot().state).toBe('error');

    fail = false;
    await advance(30_000);
    expect(engine.getSnapshot().state).toBe('idle');
    engine.stop();
  });
});

// Keeps the Mutation import honest: the engine sends exactly what the shared schema describes.
const _typecheck: Mutation[] = [];
void _typecheck;
