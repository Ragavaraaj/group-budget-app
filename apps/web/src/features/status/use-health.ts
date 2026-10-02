import { healthResponseSchema, type HealthResponse } from '@budget/shared';
import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';

export type HealthState =
  | { kind: 'checking' }
  | { kind: 'online'; health: HealthResponse }
  /** `deviceOffline` distinguishes "no network on this device" from "server is down". */
  | { kind: 'unreachable'; deviceOffline: boolean };

/** Polls /api/healthz once on mount and again whenever the browser regains connectivity. */
export function useHealth(): HealthState {
  const [state, setState] = useState<HealthState>({ kind: 'checking' });

  useEffect(() => {
    let controller = new AbortController();

    async function check() {
      controller.abort();
      controller = new AbortController();
      const { signal } = controller;
      try {
        const health = await apiGet('/api/healthz', healthResponseSchema, signal);
        setState({ kind: 'online', health });
      } catch {
        if (!signal.aborted) setState({ kind: 'unreachable', deviceOffline: !navigator.onLine });
      }
    }

    const onOnline = () => void check();
    const onOffline = () => setState({ kind: 'unreachable', deviceOffline: true });

    void check();
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      controller.abort();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return state;
}
