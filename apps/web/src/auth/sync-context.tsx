import type { MeResponse } from '@budget/shared';
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react';
import { toast } from 'sonner';
import { type BudgetDb, getDb } from '@/db/database';
import { createHttpSyncApi } from '@/sync/api';
import { SyncEngine, type SyncStatus } from '@/sync/engine';
import { LiveChannel } from '@/sync/live';
import { useAuth } from './auth-context';

interface SignedIn {
  me: MeResponse;
  db: BudgetDb;
  engine: SyncEngine;
  live: LiveChannel;
}

const SignedInContext = createContext<SignedIn | null>(null);

/**
 * Everything that exists only for a signed-in person: their own local database and the sync
 * engine that keeps it current. Rendered below the auth gate, so there is always a person.
 */
export function SignedInProvider({ me, children }: { me: MeResponse; children: ReactNode }) {
  const { markSessionExpired } = useAuth();
  const userId = me.user.id;

  // The database and engine belong to the person, so they survive re-checks of the session.
  const stack = useMemo(() => {
    const db = getDb(userId);
    // The live connection and the engine need each other: it tells the engine about news, and
    // the engine's pushes carry its id. `engine` is assigned just below, before anything runs.
    let engine: SyncEngine;
    const live = new LiveChannel({
      onChanged: () => engine.onLiveNews(),
      onConnection: (connected) => engine.setLive(connected),
      canConnect: () =>
        navigator.onLine &&
        document.visibilityState === 'visible' &&
        engine.getSnapshot().state !== 'signed_out',
    });
    engine = new SyncEngine({
      db,
      api: createHttpSyncApi(() => live.id),
      userId,
      events: {
        onConflicts: (count) =>
          toast.info(
            count === 1
              ? 'Someone else also changed an expense you edited. Your version was kept.'
              : `Someone else also changed ${count} expenses you edited. Your versions were kept.`,
          ),
        onRejected: (rejections) =>
          toast.error(
            `${rejections.length} change${rejections.length === 1 ? '' : 's'} couldn’t be saved to the server and ${rejections.length === 1 ? 'was' : 'were'} undone on this device. See Settings.`,
          ),
        onRemoved: (name) =>
          toast.info(
            `“${name}” is no longer available to you: you were removed, or the group was deleted.`,
          ),
      },
    });
    return { db, engine, live };
  }, [userId]);
  const value = useMemo<SignedIn>(() => ({ me, ...stack }), [me, stack]);

  useEffect(() => {
    value.engine.start();
    value.live.start();
    // Ask the browser not to evict our data under storage pressure (best effort).
    void navigator.storage?.persist?.();
    const unsubscribe = value.engine.subscribe(() => {
      if (value.engine.getSnapshot().state === 'signed_out') markSessionExpired();
    });
    return () => {
      unsubscribe();
      // The engine first: stopping the connection tells it "no longer live", and a stopped
      // engine ignores that, where a running one would start a sync it can't finish (the
      // database may be gone by then, after sign-out) or one that duplicates the next provider's.
      value.engine.stop();
      value.live.stop();
    };
  }, [value, markSessionExpired]);

  return <SignedInContext.Provider value={value}>{children}</SignedInContext.Provider>;
}

function useSignedIn(): SignedIn {
  const context = useContext(SignedInContext);
  if (!context) throw new Error('This must be used by a signed-in screen');
  return context;
}

export const useMe = () => useSignedIn().me;
export const useDb = () => useSignedIn().db;
export const useEngine = () => useSignedIn().engine;

export function useSyncStatus(): SyncStatus {
  const engine = useEngine();
  return useSyncExternalStore(engine.subscribe, engine.getSnapshot);
}
