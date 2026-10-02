import { type Mutation, type PullResponse, uuidv7 } from '@budget/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
const environment: Environment = { isOnline: () => online, isVisible: () => visible };

beforeEach(async () => {
  online = true;
  visible = true;
  db = new BudgetDb(`test-${uuidv7()}`);
  await db.open();
});

afterEach(() => vi.useRealTimers());

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

    it('stops and keeps the queue when the session has ended', async () => {
      await queueExpenses(2);
      const engine = engineFor(new FakeApi(() => Promise.reject(httpError(401))));
      await engine.trigger();
      expect(engine.getSnapshot().state).toBe('signed_out');
      expect(await db.outbox.count()).toBe(2); // waits for a new sign-in
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
