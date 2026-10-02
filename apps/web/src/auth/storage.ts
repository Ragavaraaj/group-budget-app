import type { MeResponse } from '@budget/shared';

// Small things kept in localStorage. Everything here is optional: private windows and
// storage-blocked browsers throw, and the app must still work without it.

const ME_KEY = 'gb:me';
const ATTEMPT_KEY = 'gb:attempt';

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not available; carry on without.
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Not available; nothing to remove.
  }
}

/**
 * Who was signed in last. Lets the app open offline, straight into that person's local data,
 * without asking the server first.
 */
export const cachedMe = {
  read: () => read<MeResponse>(ME_KEY),
  write: (me: MeResponse) => write(ME_KEY, me),
  clear: () => remove(ME_KEY),
};

export interface PendingAttempt {
  /** The secret that only this device knows. Only its hash ever leaves the device. */
  secret: string;
  startedAt: number;
}

export const pendingAttempt = {
  read: () => read<PendingAttempt>(ATTEMPT_KEY),
  write: (attempt: PendingAttempt) => write(ATTEMPT_KEY, attempt),
  clear: () => remove(ATTEMPT_KEY),
};
