import { attemptHashSchema, randomToken, sha256Hex } from '@budget/shared';
import { z } from 'zod';
import { ApiError, apiSend, NetworkError } from '@/lib/api';
import { pendingAttempt } from './storage';

/** How long a started sign-in stays redeemable on this device (the server allows 5+5 minutes). */
export const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;

/**
 * True when running as an installed app ("Add to Home Screen"), where on iOS the Google
 * redirect may end up outside the app. Browser tabs, Android and desktop use the plain redirect.
 */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Where "Continue with Google" goes. In the installed app the sign-in carries an attempt hash,
 * so it can be finished in whichever browser iOS opens and then handed back (docs/auth.md).
 */
export async function googleStartUrl(options: { invite?: string } = {}): Promise<string> {
  const params = new URLSearchParams();
  if (options.invite) params.set('invite', options.invite);
  if (isStandalone()) {
    const secret = randomToken();
    pendingAttempt.write({ secret, startedAt: Date.now() });
    const hash = await sha256Hex(secret);
    if (attemptHashSchema.safeParse(hash).success) params.set('attempt', hash);
  }
  const query = params.toString();
  return `/api/auth/google/start${query ? `?${query}` : ''}`;
}

/** A sign-in this device started and may still be waiting on. */
export function hasPendingAttempt(now = Date.now()): boolean {
  const attempt = pendingAttempt.read();
  if (!attempt) return false;
  if (now - attempt.startedAt > ATTEMPT_WINDOW_MS) {
    pendingAttempt.clear();
    return false;
  }
  return true;
}

export function cancelAttempt(): void {
  pendingAttempt.clear();
}

const redeemSchema = z.object({
  status: z.enum(['pending', 'signed_in']),
  /** The group invite the person arrived with, if they did: the app opens its join page next. */
  invite: z.string().optional(),
});

export type RedeemResult = { signedIn: false } | { signedIn: true; invite?: string };

/** Asks the server for the sign-in the browser completed. Signed in once this device has it. */
export async function redeemAttempt(): Promise<RedeemResult> {
  const attempt = pendingAttempt.read();
  if (!attempt) return { signedIn: false };
  try {
    const { status, invite } = await apiSend(
      'POST',
      '/api/auth/attempt/redeem',
      { secret: attempt.secret },
      redeemSchema,
    );
    if (status === 'signed_in') {
      pendingAttempt.clear();
      return { signedIn: true, ...(invite ? { invite } : {}) };
    }
  } catch (error) {
    if (!(error instanceof NetworkError || error instanceof ApiError)) throw error;
  }
  return { signedIn: false };
}
