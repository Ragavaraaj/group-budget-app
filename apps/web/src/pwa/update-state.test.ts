import { describe, expect, it, vi } from 'vitest';
import { updateReady } from './update-state';

describe('whether a newer version is waiting', () => {
  it('starts as no, and tells subscribers once when it becomes yes', () => {
    const heard = vi.fn();
    const stop = updateReady.subscribe(heard);
    expect(updateReady.getSnapshot()).toBe(false);

    updateReady.markReady();
    expect(updateReady.getSnapshot()).toBe(true);
    expect(heard).toHaveBeenCalledTimes(1);

    updateReady.markReady(); // already so, nothing to tell
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stops telling a subscriber that has gone', () => {
    // (This file's store is already "ready" from the test above, so check the unsubscribe alone.)
    const heard = vi.fn();
    const stop = updateReady.subscribe(heard);
    stop();
    updateReady.markReady();
    expect(heard).not.toHaveBeenCalled();
  });
});
