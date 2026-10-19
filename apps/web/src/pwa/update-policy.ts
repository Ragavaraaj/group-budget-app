/**
 * When a new version of the app is applied without asking.
 *
 * A browser keeps running the version it has until an update is activated, and a plain reload
 * does not do that: the new version just waits. So someone who reloads, without tapping the
 * "new version" message, can stay on old code (and its bugs) for as long as they like.
 *
 * Right after the app opens, and before the person has touched anything, a reload loses
 * nothing, so an update found then is applied at once. Every other time it waits for a tap on
 * Reload, so it never replaces the code under a form being filled in.
 *
 * Activating a new version reloads every open tab of the app. So each tab also decides, when the
 * new version takes over, whether *it* may reload (`mayReloadNow`): one that has been used, or is
 * waiting for a sign-in, offers the reload instead of forcing it.
 */

/**
 * An update found within this long of the app opening counts as "right after it opened". This is
 * a heuristic on purpose: the message comes when the new version has finished installing, which
 * on a slow connection can be later than this. Then the person is asked, and the next plain
 * reload finds it already waiting, which is found within milliseconds and so is applied.
 */
export const STARTUP_WINDOW_MS = 10_000;

/**
 * A second automatic update this soon after the first means something is wrong (the new version
 * did not take over). Ask instead of reloading again, so the app can never reload in a loop.
 * The time of the last one comes from the wall clock. If the clock has been set back since, the
 * gap is negative: that is treated as long ago, since a time in the future would otherwise switch
 * this off until the clock caught up. The worst case is one extra reload, because each automatic
 * update writes down the new time.
 */
export const AUTO_UPDATE_COOLDOWN_MS = 60_000;

export interface UpdateMoment {
  /** How long the app has been open (`performance.now()`). */
  openedForMs: number;
  /** How long ago an update was last applied automatically; null if never. */
  sinceLastAutoUpdateMs: number | null;
  /** The person has tapped, touched or typed since the app opened. */
  userHasInteracted: boolean;
  /**
   * A sign-in this device started is waiting to be collected. Collecting it works once, and a
   * reload in the middle can lose the answer.
   */
  signInPending: boolean;
}

/** Whether to apply a waiting update now, without asking. */
export function shouldApplyAtStartup(moment: UpdateMoment): boolean {
  if (moment.openedForMs > STARTUP_WINDOW_MS) return false;
  if (moment.userHasInteracted || moment.signInPending) return false;
  const since = moment.sinceLastAutoUpdateMs;
  return since === null || since < 0 || since > AUTO_UPDATE_COOLDOWN_MS;
}

/**
 * Whether this tab may reload when a new version takes over. The person asking for the reload
 * always may. Otherwise a tab that has been used, or that is waiting for a sign-in, keeps what it
 * has and offers the reload instead. (The tab that decided to apply the update, and every other
 * tab, are asked this once the new version is in control.)
 */
export function mayReloadNow(state: {
  askedToReload: boolean;
  userHasInteracted: boolean;
  signInPending: boolean;
}): boolean {
  return state.askedToReload || !(state.userHasInteracted || state.signInPending);
}
