/**
 * Which other tabs of the app are open, through the Web Locks API: every open page holds a shared
 * lock for as long as it lives, and any page can list who holds one. No messages to send and no
 * timeout to wait out, and a page that is closed or crashes lets go of its lock by itself.
 */

/** The part of `navigator.locks` used here (and what a test stands in for). */
export interface TabLocks {
  request(
    name: string,
    options: { mode: 'shared' },
    callback: () => Promise<unknown>,
  ): Promise<unknown>;
  query(): Promise<{ held?: { name?: string }[] }>;
}

const TAB_LOCK = 'gb:open-tab';

const browserLocks = (): TabLocks | undefined =>
  typeof navigator === 'undefined' ? undefined : (navigator.locks as TabLocks | undefined);

/** Whether this page's own lock has been granted yet (so it is counted among those held). */
let announced = false;

/** Makes this page known to the others. Call once when the app starts. */
export function announceTab(locks: TabLocks | undefined = browserLocks()): void {
  if (!locks) return;
  locks
    .request(TAB_LOCK, { mode: 'shared' }, () => {
      announced = true;
      return new Promise<never>(() => {}); // held until the page goes away
    })
    .catch(() => {});
}

/** True if another tab is open, false if this is the only one, null if the browser can't say. */
export async function otherTabsOpen(
  locks: TabLocks | undefined = browserLocks(),
): Promise<boolean | null> {
  if (!locks || !announced) return null;
  try {
    const { held = [] } = await locks.query();
    return held.filter((lock) => lock.name === TAB_LOCK).length > 1;
  } catch {
    return null;
  }
}

/** For tests: forget that this page announced itself. */
export function resetTabPresence(): void {
  announced = false;
}
