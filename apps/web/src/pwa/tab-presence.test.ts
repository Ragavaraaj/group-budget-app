import { beforeEach, describe, expect, it } from 'vitest';
import { announceTab, otherTabsOpen, resetTabPresence, type TabLocks } from './tab-presence';

/** A browser's lock manager, shared by every "tab" that is given it. */
function fakeLocks() {
  const held: { name: string }[] = [];
  const locks: TabLocks = {
    request: async (name, _options, callback) => {
      held.push({ name });
      return callback();
    },
    query: async () => ({ held: [...held] }),
  };
  return { locks, held };
}

beforeEach(() => resetTabPresence());

describe('which other tabs are open', () => {
  it('says this is the only one when only its own lock is held', async () => {
    const { locks } = fakeLocks();
    announceTab(locks);
    await Promise.resolve();
    expect(await otherTabsOpen(locks)).toBe(false);
  });

  it('says another tab is open when a second lock is held', async () => {
    const { locks, held } = fakeLocks();
    announceTab(locks);
    held.push({ name: 'gb:open-tab' }); // another tab announced itself
    await Promise.resolve();
    expect(await otherTabsOpen(locks)).toBe(true);
  });

  it('ignores locks held for other things', async () => {
    const { locks, held } = fakeLocks();
    announceTab(locks);
    held.push({ name: 'something-else' });
    await Promise.resolve();
    expect(await otherTabsOpen(locks)).toBe(false);
  });

  it('cannot say when the browser has no locks, or this page has not announced itself yet', async () => {
    expect(await otherTabsOpen(undefined)).toBeNull();
    const { locks } = fakeLocks();
    expect(await otherTabsOpen(locks)).toBeNull(); // announceTab() was never called
  });

  it('cannot say when asking fails', async () => {
    const { locks } = fakeLocks();
    announceTab(locks);
    await Promise.resolve();
    const broken: TabLocks = {
      ...locks,
      query: async () => {
        throw new Error('nope');
      },
    };
    expect(await otherTabsOpen(broken)).toBeNull();
  });

  it('does nothing when the browser has no locks', () => {
    expect(() => announceTab(undefined)).not.toThrow();
  });
});
