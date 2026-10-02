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
import { httpSyncApi } from '@/sync/api';
import { SyncEngine, type SyncStatus } from '@/sync/engine';
import { useAuth } from './auth-context';

interface SignedIn {
  me: MeResponse;
  db: BudgetDb;
  engine: SyncEngine;
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
    const engine = new SyncEngine({
      db,
      api: httpSyncApi,
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
        onRemoved: (name) => toast.info(`You’re no longer in “${name}”.`),
      },
    });
    return { db, engine };
  }, [userId]);
  const value = useMemo<SignedIn>(() => ({ me, ...stack }), [me, stack]);

  useEffect(() => {
    value.engine.start();
    // Ask the browser not to evict our data under storage pressure (best effort).
    void navigator.storage?.persist?.();
    const unsubscribe = value.engine.subscribe(() => {
      if (value.engine.getSnapshot().state === 'signed_out') markSessionExpired();
    });
    return () => {
      unsubscribe();
      value.engine.stop();
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
