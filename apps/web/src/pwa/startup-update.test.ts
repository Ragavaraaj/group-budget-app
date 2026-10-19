import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTIVATION_GRACE_MS,
  handleUpdateFound,
  type LastAutoUpdate,
  type UpdateFound,
} from './startup-update';
import { AUTO_UPDATE_COOLDOWN_MS } from './update-policy';

const NOW = 1_000_000_000;
let offered: number;
let activated: number;

/** A store that remembers what was written, and the order things happened in. */
function store(initial: number | null = null, events: string[] = []) {
  let at = initial;
  const writes: number[] = [];
  const lastAutoUpdate: LastAutoUpdate = {
    read: () => at,
    write: (value) => {
      writes.push(value);
      events.push('write');
      at = value;
      return true;
    },
  };
  return { lastAutoUpdate, writes };
}

/** A browser that has just opened and is quiet: the case that is applied. */
function quiet(overrides: Partial<UpdateFound> = {}): UpdateFound {
  return {
    openedForMs: () => 1_000,
    now: () => NOW,
    lastAutoUpdate: store().lastAutoUpdate,
    userHasInteracted: () => false,
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
    await handleUpdateFound(quiet());
    expect(activated).toBe(1);
    // The page reloads once the new version takes over, so nothing else happens.
    expect(offered).toBe(0);
  });

  it('writes down when it was applied, and does that before applying it', async () => {
    const events: string[] = [];
    const { lastAutoUpdate, writes } = store(null, events);
    await handleUpdateFound(
      quiet({
        lastAutoUpdate,
        activate: async () => {
          events.push('activate');
        },
      }),
    );
    expect(writes).toEqual([NOW]);
    expect(events).toEqual(['write', 'activate']);
  });

  const offeredWhen: [string, Partial<UpdateFound>][] = [
    ['it was found late', { openedForMs: () => 60_000 }],
    ['the person has already touched something', { userHasInteracted: () => true }],
    ['a sign-in is waiting to be collected', { signInPending: () => true }],
  ];
  it.each(offeredWhen)('is offered, not applied, when %s', async (_why, change) => {
    const { lastAutoUpdate, writes } = store();
    await handleUpdateFound(quiet({ lastAutoUpdate, ...change }));
    expect(activated).toBe(0);
    expect(offered).toBe(1);
    expect(writes).toEqual([]); // nothing was applied, so nothing is written down
  });
});

describe('the guard against reloading in a loop', () => {
  it('offers, not applies, right after another automatic update', async () => {
    const { lastAutoUpdate, writes } = store(NOW - 5_000);
    await handleUpdateFound(quiet({ lastAutoUpdate }));
    expect(activated).toBe(0);
    expect(offered).toBe(1);
    expect(writes).toEqual([]);
  });

  it('offers at exactly one cooldown after the last one, and applies a moment later', async () => {
    const atCooldown = store(NOW - AUTO_UPDATE_COOLDOWN_MS);
    await handleUpdateFound(quiet({ lastAutoUpdate: atCooldown.lastAutoUpdate }));
    expect(activated).toBe(0);
    expect(offered).toBe(1);

    const justAfter = store(NOW - AUTO_UPDATE_COOLDOWN_MS - 1);
    await handleUpdateFound(quiet({ lastAutoUpdate: justAfter.lastAutoUpdate }));
    expect(activated).toBe(1);
    expect(justAfter.writes).toEqual([NOW]); // and it writes the new time down
  });

  it('applies when the last one was long ago (the gap is now minus then, not the reverse)', async () => {
    const { lastAutoUpdate } = store(NOW - 2 * 60 * 60_000);
    await handleUpdateFound(quiet({ lastAutoUpdate }));
    expect(activated).toBe(1);
    expect(offered).toBe(0);
  });

  it('applies when the stored time is in the future, as when the clock was set back', async () => {
    const { lastAutoUpdate } = store(NOW + 3 * 60 * 60_000);
    await handleUpdateFound(quiet({ lastAutoUpdate }));
    expect(activated).toBe(1);
  });

  it('offers, not applies, when the time of this update cannot be written down', async () => {
    await handleUpdateFound(quiet({ lastAutoUpdate: { read: () => null, write: () => false } }));
    expect(activated).toBe(0);
    expect(offered).toBe(1);
  });

  it('offers if anything it checks goes wrong, rather than losing the update', async () => {
    await handleUpdateFound(
      quiet({
        signInPending: () => {
          throw new Error('storage is broken');
        },
      }),
    );
    expect(activated).toBe(0);
    expect(offered).toBe(1);
  });
});

describe('when applying does not work', () => {
  it('offers it at once if asking the new version to take over fails', async () => {
    await handleUpdateFound(
      quiet({
        activate: async () => {
          throw new Error('no worker');
        },
      }),
    );
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
