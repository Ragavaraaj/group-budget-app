import { beforeEach, describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { tryLocal } from '@/lib/local-errors';

beforeEach(() => toast.error.mockClear());

describe('tryLocal', () => {
  it('reports success without bothering the person', async () => {
    expect(await tryLocal(async () => 'saved')).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('turns a refused write (storage full, a closed database) into a message and a false', async () => {
    const quota = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    expect(await tryLocal(() => Promise.reject(quota))).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Free up some storage'));
  });

  it('never throws, so a form can always carry on', async () => {
    await expect(tryLocal(() => Promise.reject(new Error('boom')))).resolves.toBe(false);
  });
});
