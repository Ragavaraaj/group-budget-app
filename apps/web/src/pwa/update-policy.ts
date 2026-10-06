/**
 * When a new version of the app is applied without asking.
 *
 * A browser keeps running the version it has until the update is activated, and a plain reload
 * does not do that: the new version just waits. So someone who reloads, without tapping the
 * "new version" message, can stay on old code (and its bugs) for as long as they like.
 *
 * Right after the app opens nothing can be half-entered, so an update found then is applied at
 * once. One found later (a tab left open for hours) still waits for the person to tap Reload,
 * so it never replaces the code under a form being filled in.
 */

/** An update found within this long of the app opening counts as "right after it opened". */
export const STARTUP_WINDOW_MS = 10_000;

/**
 * A second automatic update this soon after the first means something is wrong (the new version
 * did not take over). Ask instead of reloading again, so the app can never reload in a loop.
 */
export const AUTO_UPDATE_COOLDOWN_MS = 60_000;

export interface UpdateMoment {
  /** How long the app has been open (`performance.now()`). */
  openedForMs: number;
  /** How long ago this tab applied an update by itself; null if it never has. */
  sinceLastAutoUpdateMs: number | null;
}

export function shouldApplyAtStartup({
  openedForMs,
  sinceLastAutoUpdateMs,
}: UpdateMoment): boolean {
  if (openedForMs > STARTUP_WINDOW_MS) return false;
  return sinceLastAutoUpdateMs === null || sinceLastAutoUpdateMs > AUTO_UPDATE_COOLDOWN_MS;
}
