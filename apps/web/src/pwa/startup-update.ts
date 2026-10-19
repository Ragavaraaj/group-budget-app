import { shouldApplyAtStartup } from './update-policy';

/**
 * How long to wait for the new version to take over after asking it to. The page reloads when it
 * does; if it has not by now it is not going to, and the person is asked instead.
 */
export const ACTIVATION_GRACE_MS = 8_000;

export interface LastAutoUpdate {
  read(): number | null;
  /** False when the time could not be written down. */
  write(at: number): boolean;
}

/** Everything a decision about a waiting update needs, so each part can be stood in for in a test. */
export interface UpdateFound {
  /** How long the app has been open. */
  openedForMs(): number;
  now(): number;
  lastAutoUpdate: LastAutoUpdate;
  userHasInteracted(): boolean;
  signInPending(): boolean;
  /** Asks the waiting version to take over; the page reloads by itself once it has. */
  activate(): Promise<unknown> | undefined;
  /** Shows the "new version" message with its Reload. */
  offer(): void;
}

/**
 * A new version is waiting. Applies it now if that is safe (see `update-policy.ts`), or offers it.
 * Whatever goes wrong, the person ends up either on the new version or being offered it: they are
 * never left on old code with nothing said.
 */
export async function handleUpdateFound(deps: UpdateFound): Promise<void> {
  try {
    const last = deps.lastAutoUpdate.read();
    const apply = shouldApplyAtStartup({
      openedForMs: deps.openedForMs(),
      sinceLastAutoUpdateMs: last === null ? null : deps.now() - last,
      userHasInteracted: deps.userHasInteracted(),
      signInPending: deps.signInPending(),
    });
    // Written down before activating: if it can't be, nothing would stop a reload loop.
    if (!apply || !deps.lastAutoUpdate.write(deps.now())) {
      deps.offer();
      return;
    }
  } catch {
    deps.offer();
    return;
  }

  // Asking says nothing about whether it worked: it does not report success, and when the new
  // version never takes over it raises nothing either. So give it a while, then ask.
  const giveUp = setTimeout(deps.offer, ACTIVATION_GRACE_MS);
  try {
    await deps.activate();
  } catch {
    clearTimeout(giveUp);
    deps.offer();
  }
}
