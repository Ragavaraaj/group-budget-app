import { MAX_MUTATIONS_PER_PUSH, type Mutation, type MutationResult } from '@budget/shared';
import { applyPull, BACKFILL_PREFIX } from '@/db/apply';
import { type BudgetDb, getMeta, setMeta } from '@/db/database';
import { onLocalWrite } from '@/db/repo';
import { entityTables, tableFor } from '@/db/tables';
import { entityKey, type OutboxEntry, type Rejection } from '@/db/types';
import { ApiError, NetworkError } from '@/lib/api';
import type { SyncApi } from './api';

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error' | 'signed_out';

/** Which part of a sync went wrong, in words a person can read out. */
export type SyncStep = 'sending changes' | 'receiving changes' | 'loading a group' | 'syncing';

interface StepDetail {
  step: SyncStep;
  /** The HTTP status and the server's error code, or the error's name and message. */
  detail: string;
}

/** Why the last sync failed. Without it "Sync problem" can't be told apart on a phone. */
export interface SyncFailure extends StepDetail {
  /** A second step that failed in the same cycle, when the first did not stop it. */
  also?: StepDetail;
}

export interface SyncStatus {
  state: SyncState;
  lastSyncedAt: number | null;
  /** The live connection is up, so changes arrive as they happen. */
  live: boolean;
  /** Why the last sync failed. Only set while `state` is `error`. */
  failure: SyncFailure | null;
  /**
   * The last sync received everything the server had: every page of the pull and every group
   * backfill. It can be true while `state` is `error`, when only sending changes failed.
   */
  caughtUp: boolean;
}

/** Things the UI wants to tell the person about; the engine itself shows nothing. */
export interface SyncEvents {
  /** Edits that were applied but had been made from an out-of-date copy. */
  onConflicts?(count: number): void;
  /** Changes the server refused. */
  onRejected?(rejections: Rejection[]): void;
  /** This person was removed from a group; its data was deleted from the device. */
  onRemoved?(groupName: string): void;
}

export interface Environment {
  isOnline(): boolean;
  isVisible(): boolean;
}

const browserEnvironment: Environment = {
  isOnline: () => navigator.onLine,
  isVisible: () => document.visibilityState === 'visible',
};

export interface EngineOptions {
  db: BudgetDb;
  api: SyncApi;
  userId: string;
  events?: SyncEvents;
  environment?: Environment;
  /** How often to ask for news while the app is open (default 30 s). */
  pollMs?: number;
  /** When nothing changes the interval doubles up to this (default 5 min). */
  maxPollMs?: number;
}

const MAX_REJECTIONS = 50;
const PULL_PAGE = 100;

/** Rejection reason for a change the server could not even parse. */
const INVALID = 'invalid';

export class SyncEngine {
  private readonly db: BudgetDb;
  private readonly api: SyncApi;
  private readonly userId: string;
  private readonly events: SyncEvents;
  private readonly env: Environment;
  private readonly pollMs: number;
  private readonly maxPollMs: number;

  private status: SyncStatus = {
    state: 'idle',
    lastSyncedAt: null,
    live: false,
    failure: null,
    caughtUp: false,
  };
  private readonly subscribers = new Set<() => void>();

  private running: Promise<void> | null = null;
  private rerun = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private interval: number;
  private started = false;
  /** True while the live connection is up: news arrives by itself, so polling is a safety net. */
  private live = false;
  private unsubscribeWrites: (() => void) | null = null;
  /** Something was sent (and answered) in the current cycle, even if a later part failed. */
  private sentThisCycle = false;
  /** The failure last written to the console, so a failure that repeats is logged once. */
  private loggedFailure: string | null = null;

  constructor(options: EngineOptions) {
    this.db = options.db;
    this.api = options.api;
    this.userId = options.userId;
    this.events = options.events ?? {};
    this.env = options.environment ?? browserEnvironment;
    this.pollMs = options.pollMs ?? 30_000;
    this.maxPollMs = options.maxPollMs ?? 5 * 60_000;
    this.interval = this.pollMs;
  }

  // --- status, for the UI ------------------------------------------------------------------

  readonly subscribe = (listener: () => void): (() => void) => {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  };

  readonly getSnapshot = (): SyncStatus => this.status;

  private setStatus(patch: Partial<SyncStatus>) {
    const next = { ...this.status, ...patch };
    // A reason belongs to the error it explains, so any other state has none.
    this.status = next.state === 'error' ? next : { ...next, failure: null };
    for (const listener of this.subscribers) listener();
  }

  // --- lifecycle ----------------------------------------------------------------------------

  /** Syncs now, and keeps syncing: on focus, on reconnect, after local writes, and by polling. */
  start(): void {
    if (this.started) return;
    this.started = true;
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.unsubscribeWrites = onLocalWrite(this.onWrite);
    void this.trigger();
  }

  stop(): void {
    this.started = false;
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.unsubscribeWrites?.();
    this.unsubscribeWrites = null;
    this.clearTimer();
  }

  private readonly onOnline = () => {
    this.interval = this.pollMs;
    void this.trigger();
  };
  private readonly onOffline = () => this.setStatus({ state: 'offline' });
  private readonly onVisibility = () => {
    if (this.env.isVisible()) {
      this.interval = this.pollMs;
      void this.trigger();
    } else this.clearTimer(); // stop polling while hidden
  };
  private readonly onWrite = () => {
    this.interval = this.pollMs;
    void this.trigger();
  };

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule() {
    this.clearTimer();
    if (!this.started || !this.env.isVisible() || this.status.state === 'signed_out') return;
    // With the live connection up the server says when there is news, so polling only has to
    // catch what a dropped message could miss: the slowest interval will do.
    const delay = this.live ? this.maxPollMs : this.interval;
    this.timer = setTimeout(() => void this.trigger(), delay);
  }

  /**
   * The live connection came up or went down. Coming up slows the polling down; going down
   * brings the normal interval back and syncs once, to pick up anything missed meanwhile. The
   * connection is also closed on purpose whenever the app goes to the background, and then
   * there is nothing to catch up on: the sync on coming back to the front does that.
   */
  setLive(live: boolean): void {
    if (this.live === live) return;
    this.live = live;
    this.setStatus({ live });
    if (!this.started) return;
    if (live) {
      // Connecting is itself a moment to catch up (the app may have been away).
      void this.trigger();
    } else {
      this.interval = this.pollMs;
      if (this.env.isVisible()) void this.trigger();
    }
  }

  /** The server says something changed. Same as asking for a sync, and never backs off. */
  readonly onLiveNews = (): void => {
    this.interval = this.pollMs;
    void this.trigger();
  };

  // --- running a sync ----------------------------------------------------------------------

  /**
   * Asks for a sync. If one is already running, another follows it, so a write made mid-sync
   * is never left behind. The returned promise settles when everything requested has finished.
   */
  trigger(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.rerun = false;
          await this.cycle();
        } while (this.rerun);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async cycle(): Promise<void> {
    this.clearTimer();
    if (!this.env.isOnline()) {
      this.setStatus({ state: 'offline', caughtUp: false });
      this.scheduleNext(false); // the `online` event normally wakes us; this is the safety net
      return;
    }
    this.setStatus({ state: 'syncing' });
    this.sentThisCycle = false;

    let changed = false;
    // A failed push, when the cycle went on to pull anyway (so it can't be lost if that fails too).
    let held: StepFailed | null = null;
    try {
      try {
        await inStep('sending changes', () => this.flush());
      } catch (error) {
        // A change the server can't take must not keep its news off this device: a group the
        // person has just joined arrives by pulling, and would never show up while one stuck
        // change sat first in the queue. The pull leaves rows with unsent edits alone, so going
        // on is safe. If the session ended or the network is gone the pull fails the same way, so
        // those stop here.
        if (!(error instanceof StepFailed) || endsCycle(error)) throw error;
        held = error;
      }
      const pulled = await inStep('receiving changes', () => this.pull());
      const backfilled = await inStep('loading a group', () => this.runBackfills());
      changed = pulled || backfilled || this.sentThisCycle;
      if (held !== null) throw held;
      this.loggedFailure = null;
      this.setStatus({ state: 'idle', lastSyncedAt: Date.now(), caughtUp: true });
    } catch (error) {
      const failed = error instanceof StepFailed ? error : new StepFailed('syncing', error);
      // What was sent is progress even when a later chunk wasn't taken.
      changed = changed || this.sentThisCycle;
      if (isSessionEnd(failed.original)) {
        // The session ended. Keep working from local data; the queue waits for a new sign-in.
        this.setStatus({ state: 'signed_out', caughtUp: false });
        return;
      }
      if (failed.original instanceof NetworkError) {
        this.setStatus({ state: 'offline', caughtUp: false });
      } else {
        this.fail(held !== null && held !== failed ? [held, failed] : [failed]);
      }
    }
    this.scheduleNext(changed);
  }

  /** Records why the cycle failed: in the status, and once in the console while it keeps failing. */
  private fail(failures: StepFailed[]): void {
    const [first, second] = failures;
    if (!first) return;
    const failure: SyncFailure = {
      step: first.step,
      detail: describeError(first.original),
      ...(second ? { also: { step: second.step, detail: describeError(second.original) } } : {}),
    };
    // Only the sending failed: the pull and the backfills ran and finished.
    const caughtUp = first.step === 'sending changes' && second === undefined;
    this.setStatus({ state: 'error', failure, caughtUp });

    const key = JSON.stringify(failure);
    if (key === this.loggedFailure) return; // the same failure on every retry would flood the console
    this.loggedFailure = key;
    for (const failed of failures)
      console.error(`Sync failed while ${failed.step}`, failed.original);
  }

  /**
   * Polls at the base interval while there is news, and backs off (doubling, up to the cap)
   * while there is none, so an idle phone barely touches the server.
   */
  private scheduleNext(changed: boolean) {
    if (changed) this.interval = this.pollMs;
    this.schedule();
    if (!changed) this.interval = Math.min(this.interval * 2, this.maxPollMs);
  }

  // --- pushing ------------------------------------------------------------------------------

  private async flush(): Promise<void> {
    for (;;) {
      const entries = await this.db.outbox.orderBy('seq').limit(MAX_MUTATIONS_PER_PUSH).toArray();
      if (entries.length === 0) return;
      const results = await this.pushChunk(entries);
      await this.settle(entries, results);

      // Every change should have been answered. If none was (a misbehaving server), stop here
      // rather than sending the same request forever; the next sync tries again.
      const stillQueued = await this.db.outbox.bulkGet(entries.map((e) => e.seq as number));
      if (stillQueued.every((entry) => entry !== undefined)) {
        throw new Error('The server did not answer any of the queued changes');
      }
      this.sentThisCycle = true; // only an answered request is progress
    }
  }

  /** One request; if the server calls it malformed, find which change is the culprit. */
  private async pushChunk(entries: OutboxEntry[]): Promise<MutationResult[]> {
    try {
      return await this.api.push(entries.map(toMutation));
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 400)) throw error;
      const [only] = entries;
      if (entries.length === 1 && only) {
        return [{ mutationId: only.mutationId, status: 'rejected', reason: INVALID as never }];
      }
      const results: MutationResult[] = [];
      for (const entry of entries) results.push(...(await this.pushChunk([entry])));
      return results;
    }
  }

  private async settle(entries: OutboxEntry[], results: MutationResult[]): Promise<void> {
    const byId = new Map(results.map((r) => [r.mutationId, r]));
    const rejections: Rejection[] = [];
    let conflicts = 0;

    await this.db.transaction(
      'rw',
      [this.db.outbox, this.db.meta, ...Object.values(entityTables(this.db))],
      async () => {
        for (const entry of entries) {
          const result = byId.get(entry.mutationId);
          if (!result || entry.seq === undefined) continue; // no answer: try again next time
          await this.db.outbox.delete(entry.seq);

          const table = tableFor(this.db, entry.entity);
          const stillQueued = await this.db.outbox
            .where('entityKey')
            .equals(entityKey(entry.entity, entry.entityId))
            .count();

          if (result.status === 'rejected') {
            const discarded = await this.undoRejected(entry, table, stillQueued);
            rejections.push({
              at: Date.now(),
              entity: entry.entity,
              entityId: entry.entityId,
              op: entry.op,
              reason: result.reason ?? 'rejected',
              discarded,
            });
            continue;
          }
          if (result.conflict) conflicts++;

          // Remember the version the server gave this row, unless newer edits are already queued
          // (they carry their own base version).
          if (result.version !== undefined && stillQueued === 0) {
            await table.update(entry.entityId, { version: result.version });
          }
        }
        if (rejections.length > 0) {
          const previous = (await getMeta<Rejection[]>(this.db, 'rejections')) ?? [];
          await setMeta(
            this.db,
            'rejections',
            [...rejections, ...previous].slice(0, MAX_REJECTIONS),
          );
        }
      },
    );

    if (conflicts > 0) this.events.onConflicts?.(conflicts);
    if (rejections.length > 0) this.events.onRejected?.(rejections);
  }

  /**
   * The server refused a change, so the device must stop showing something the server (and every
   * other device) doesn't have. A row the server never accepted is removed; a row it does hold
   * goes back to the server's version, by re-fetching the group (the next steps of this cycle).
   * Returns true when the row was removed. While later changes to the same row are still queued
   * they are judged on their own turn.
   */
  private async undoRejected(
    entry: OutboxEntry,
    table: ReturnType<typeof tableFor>,
    stillQueued: number,
  ): Promise<boolean> {
    if (stillQueued > 0) return false;
    const row = await table.get(entry.entityId);
    if (!row) return false;
    if (row.version === 0) {
      await table.delete(entry.entityId); // never reached the server: it exists nowhere else
      return true;
    }
    const key = `${BACKFILL_PREFIX}${entry.groupId}`;
    if ((await getMeta<number>(this.db, key)) === undefined) await setMeta(this.db, key, 0);
    return false;
  }

  // --- pulling ------------------------------------------------------------------------------

  private async pull(): Promise<boolean> {
    let changed = false;
    let cursor = (await getMeta<number>(this.db, 'cursor')) ?? 0;
    for (;;) {
      const response = await this.api.pull({ since: cursor, limit: PULL_PAGE });
      const result = await applyPull(this.db, response, {
        me: this.userId,
        since: cursor,
        updateCursor: true,
      });
      if (result.applied > 0 || result.removedFrom.length > 0) changed = true;
      for (const name of result.removedFrom) this.events.onRemoved?.(name);
      cursor = response.cursor;
      if (!response.hasMore) return changed;
    }
  }

  /** Fetches the full history of groups joined since the last sync, which our cursor would skip. */
  private async runBackfills(): Promise<boolean> {
    const pending = await this.db.meta.where('key').startsWith(BACKFILL_PREFIX).toArray();
    let changed = false;
    for (const { key, value } of pending) {
      const groupId = key.slice(BACKFILL_PREFIX.length);
      let cursor = typeof value === 'number' ? value : 0;
      for (;;) {
        let response: Awaited<ReturnType<SyncApi['pull']>>;
        try {
          response = await this.api.pull({ since: cursor, limit: PULL_PAGE, groupId });
        } catch (error) {
          if (error instanceof ApiError && error.status === 403) {
            await this.db.meta.delete(key); // no longer a member; nothing to fetch
            break;
          }
          throw error;
        }
        const result = await applyPull(this.db, response, {
          me: this.userId,
          since: cursor,
          updateCursor: false,
        });
        if (result.applied > 0) changed = true;
        cursor = response.cursor;
        if (response.hasMore) {
          await setMeta(this.db, key, cursor);
        } else {
          await this.db.meta.delete(key);
          break;
        }
      }
    }
    return changed;
  }
}

/** A failure of one part of a sync, saying which part. The error itself is `original`. */
class StepFailed extends Error {
  constructor(
    readonly step: SyncStep,
    readonly original: unknown,
  ) {
    super(`Sync failed while ${step}`);
    this.name = 'StepFailed';
  }
}

/** Runs one part of a sync and, if it fails, says which part. */
async function inStep<T>(step: SyncStep, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (original) {
    throw new StepFailed(step, original);
  }
}

const isSessionEnd = (error: unknown) => error instanceof ApiError && error.status === 401;

/** The session ended or the network is gone: the next part would fail the same way. */
const endsCycle = ({ original }: StepFailed) =>
  isSessionEnd(original) || original instanceof NetworkError;

/** What a person is shown: a status and code for the server's answers, a name and message otherwise. */
function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.code ? `HTTP ${error.status} (${error.code})` : `HTTP ${error.status}`;
  }
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

function toMutation(entry: OutboxEntry): Mutation {
  const base = {
    mutationId: entry.mutationId,
    baseVersion: entry.baseVersion,
    createdAt: entry.createdAt,
  };
  if (entry.op === 'upsert') {
    return { ...base, op: 'upsert', entity: entry.entity, data: entry.data } as Mutation;
  }
  return {
    ...base,
    op: entry.op,
    entity: entry.entity,
    id: entry.entityId,
    groupId: entry.groupId,
  };
}
