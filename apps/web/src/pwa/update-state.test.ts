import { afterEach, describe, expect, it, vi } from 'vitest';
import { updateReady } from './update-state';

afterEach(() => updateReady.set(false));

describe('whether a newer version is waiting', () => {
  it('starts as no, and tells subscribers when it changes', () => {
    const heard = vi.fn();
    const stop = updateReady.subscribe(heard);
    expect(updateReady.getSnapshot()).toBe(false);

    updateReady.set(true);
    expect(updateReady.getSnapshot()).toBe(true);
    expect(heard).toHaveBeenCalledTimes(1);

    updateReady.set(true); // no change, nothing to tell
    expect(heard).toHaveBeenCalledTimes(1);

    stop();
    updateReady.set(false);
    expect(heard).toHaveBeenCalledTimes(1); // no longer listening
  });
});
