import { and, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { memberships } from '../../db/schema';
import { createLogger } from '../../logger';

/** The hub is one object; this is its name. */
const HUB_NAME = 'hub';

export const hubStub = (env: Cloudflare.Env) => env.LIVE_HUB.get(env.LIVE_HUB.idFromName(HUB_NAME));

/** A device's own id for its connection, sent with its pushes so it isn't woken by them. */
export const LIVE_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Tells these people's open apps that something changed. Best effort by design: if it fails
 * (the hub is restarting, say) nothing is lost, because the apps still poll and pull on their
 * own; this only makes the common case quick.
 */
export async function notifyUsers(
  env: Cloudflare.Env,
  userIds: readonly string[],
  exclude?: string | null,
): Promise<void> {
  const users = [...new Set(userIds)];
  if (users.length === 0) return;
  try {
    await hubStub(env).fetch('https://hub/notify', {
      method: 'POST',
      body: JSON.stringify({ users, exclude: exclude ?? null }),
    });
  } catch (error) {
    createLogger('warn').warn({ err: error }, 'live update: could not reach the hub');
  }
}

/** The people currently in these groups. */
export async function activeMemberIds(db: Db, groupIds: readonly string[]): Promise<string[]> {
  if (groupIds.length === 0) return [];
  const rows = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(inArray(memberships.groupId, [...groupIds]), isNull(memberships.removedAt)));
  return [...new Set(rows.map((row) => row.userId))];
}

/**
 * Runs the notification after the response has gone, so it never slows a request down. Where
 * there is no execution context (unit tests calling the app directly) the promise simply runs.
 */
export function afterResponse(
  ctx: { waitUntil(promise: Promise<unknown>): void } | undefined,
  task: Promise<unknown>,
): void {
  const safe = task.catch(() => undefined);
  try {
    ctx?.waitUntil(safe);
  } catch {
    // No execution context: `safe` is already running on its own.
  }
}

/** The Worker's execution context, or undefined when the app is called directly (in tests). */
export function executionOf(c: {
  executionCtx: { waitUntil(promise: Promise<unknown>): void };
}): { waitUntil(promise: Promise<unknown>): void } | undefined {
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
}
