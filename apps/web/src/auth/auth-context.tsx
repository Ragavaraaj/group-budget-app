import {
  type AuthConfigResponse,
  authConfigResponseSchema,
  type MeResponse,
  meResponseSchema,
} from '@budget/shared';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { z } from 'zod';
import { wipeDb } from '@/db/database';
import { ApiError, apiCall, apiGet, apiSend, NetworkError } from '@/lib/api';
import { cancelAttempt, hasPendingAttempt, redeemAttempt } from './attempt';
import { cachedMe } from './storage';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signed_out'; config: AuthConfigResponse | null; offline: boolean }
  | {
      status: 'signed_in';
      me: MeResponse;
      /** The server no longer accepts our session: the app works, but cannot sync until sign-in. */
      sessionExpired: boolean;
      /** We could not reach the server at startup and are running from local data. */
      offline: boolean;
    };

interface AuthApi {
  state: AuthState;
  /** Re-checks the session with the server. */
  refresh(): Promise<void>;
  /** Dev-only one-step sign-in. */
  devLogin(email: string): Promise<void>;
  /** The sync engine saw a 401. */
  markSessionExpired(): void;
  /** Signs out on the server, then deletes this device's copy of the person's data. */
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthApi | null>(null);

async function loadConfig(): Promise<AuthConfigResponse | null> {
  try {
    return await apiGet('/api/auth/config', authConfigResponseSchema);
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  const refresh = useCallback(async () => {
    try {
      const me = await apiGet('/api/me', meResponseSchema);
      cachedMe.write(me);
      setState({ status: 'signed_in', me, sessionExpired: false, offline: false });
    } catch (error) {
      const cached = cachedMe.read();
      if (error instanceof ApiError && error.status === 401) {
        // Signed out on the server. If we know who this device belongs to, keep that person's
        // local data usable (and their unsent changes safe) until they sign in again.
        if (cached) {
          setState({ status: 'signed_in', me: cached, sessionExpired: true, offline: false });
        } else {
          setState({ status: 'signed_out', config: await loadConfig(), offline: false });
        }
      } else if (cached) {
        setState({ status: 'signed_in', me: cached, sessionExpired: false, offline: true });
      } else {
        setState({
          status: 'signed_out',
          config: null,
          offline: error instanceof NetworkError,
        });
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Installed-app sign-in: after the browser finishes it, collect it here. Try when the app comes
  // back to the front, and every couple of seconds while it is waiting.
  useEffect(() => {
    if (state.status === 'loading') return;
    const waiting =
      state.status === 'signed_out' || (state.status === 'signed_in' && state.sessionExpired);
    if (!waiting || !hasPendingAttempt()) return;

    let stopped = false;
    const tryRedeem = async () => {
      if (stopped || document.visibilityState !== 'visible' || !hasPendingAttempt()) return;
      if (await redeemAttempt()) await refresh();
    };
    const interval = window.setInterval(() => void tryRedeem(), 2_000);
    document.addEventListener('visibilitychange', tryRedeem);
    void tryRedeem();
    return () => {
      stopped = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', tryRedeem);
    };
  }, [state, refresh]);

  const devLogin = useCallback(
    async (email: string) => {
      await apiSend('POST', '/api/auth/dev-login', { email }, z.object({ user: z.unknown() }));
      await refresh();
    },
    [refresh],
  );

  const markSessionExpired = useCallback(() => {
    setState((current) =>
      current.status === 'signed_in' && !current.sessionExpired
        ? { ...current, sessionExpired: true }
        : current,
    );
  }, []);

  const signOut = useCallback(async () => {
    const current = state;
    await apiCall('POST', '/api/auth/logout'); // throws if offline: signing out needs the server
    cancelAttempt();
    cachedMe.clear();
    if (current.status === 'signed_in') await wipeDb(current.me.user.id);
    setState({ status: 'signed_out', config: await loadConfig(), offline: false });
  }, [state]);

  const api = useMemo<AuthApi>(
    () => ({ state, refresh, devLogin, markSessionExpired, signOut }),
    [state, refresh, devLogin, markSessionExpired, signOut],
  );
  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
