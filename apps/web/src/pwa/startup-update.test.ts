import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTIVATION_GRACE_MS, handleUpdateFound, type UpdateFound } from './startup-update';

let offered: number;
let activated: number;

/** A browser that has just opened, quiet, with one tab: the case that is applied. */
function quiet(overrides: Partial<UpdateFound> = {}): UpdateFound {
  let stored: number | null = null;
  return {
    openedForMs: () => 1_000,
    now: () => 1_000_000,
    lastAutoUpdate: {
      read: () => stored,
      write: (at) => {
        stored = at;
        return true;
      },
    },
    userHasInteracted: () => false,
    otherTabsOpen: async () => false,
    signInPending: () => false,
    activate: async () => {
      activated++;
    },
    offer: () => {
      offered++;
    },
    ...overrides,
  };
}

beforeEach(() => {
  offered = 0;
  activated = 0;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('a new version is waiting', () => {
  it('is applied when the app has just opened, and nothing is shown', async () => {
    expect(await handleUpdateFound(quiet())).toBe('activating');
    expect(activated).toBe(1);
    // The page reloads once the new version takes over, so nothing else happens.
    expect(offered).toBe(0);
  });

  it('writes down when it was applied, before applying it', async () => {
    const writes: number[] = [];
    const deps = quiet({
      lastAutoUpdate: {
        read: () => null,
        write: (at) => {
          writes.push(at);
          return true;
        },
      },
      activate: async () => {
        expect(writes).toEqual([1_000_000]); // already written by the time it is asked to apply
      },
    });
    await handleUpdateFound(deps);
    expect(writes).toEqual([1_000_000]);
  });

  const offeredWhen: [string, Partial<UpdateFound>][] = [
    ['it was found late', { openedForMs: () => 60_000 }],
    ['the person has already touched something', { userHasInteracted: () => true }],
    ['a sign-in is waiting to be collected', { signInPending: () => true }],
    ['another tab is open', { otherTabsOpen: async () => true }],
    ['the browser cannot say if another tab is open', { otherTabsOpen: async () => null }],
  ];
  it.each(offeredWhen)('is offered, not applied, when %s', async (_why, change) => {
    expect(await handleUpdateFound(quiet(change))).toBe('offered');
    expect(activated).toBe(0);
    expect(offered).toBe(1);
  });

  it('is offered, not applied, right after another automatic update (no reload loop)', async () => {
    const deps = quiet({
      lastAutoUpdate: { read: () => 1_000_000 - 5_000, write: () => true },
    });
    expect(await handleUpdateFound(deps)).toBe('offered');
    expect(activated).toBe(0);
  });

  it('is offered, not applied, when the time of this update cannot be written down', async () => {
    const deps = quiet({ lastAutoUpdate: { read: () => null, write: () => false } });
    expect(await handleUpdateFound(deps)).toBe('offered');
    expect(activated).toBe(0);
    expect(offered).toBe(1);
  });

  it('is offered if anything it checks goes wrong, rather than being lost', async () => {
    const deps = quiet({
      otherTabsOpen: async () => {
        throw new Error('locks are broken');
      },
    });
    expect(await handleUpdateFound(deps)).toBe('offered');
    expect(offered).toBe(1);
  });
});

describe('when applying does not work', () => {
  it('offers it at once if asking the new version to take over fails', async () => {
    const deps = quiet({
      activate: async () => {
        throw new Error('no worker');
      },
    });
    await handleUpdateFound(deps);
    expect(offered).toBe(1);
    // And not a second time when the wait for the reload runs out.
    await vi.advanceTimersByTimeAsync(ACTIVATION_GRACE_MS * 2);
    expect(offered).toBe(1);
  });

  it('offers it if the new version never takes over, which raises nothing', async () => {
    await handleUpdateFound(quiet()); // activate() resolves, but the page never reloads
    expect(offered).toBe(0);
    await vi.advanceTimersByTimeAsync(ACTIVATION_GRACE_MS - 1);
    expect(offered).toBe(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(offered).toBe(1);
  });
});
