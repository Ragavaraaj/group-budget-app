import { afterEach, describe, expect, it, vi } from 'vitest';
import { lastAutoUpdate } from './storage';

function stubStorage(overrides: Partial<Storage> = {}) {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    ...overrides,
  });
  return data;
}

afterEach(() => vi.unstubAllGlobals());

describe('when an update was last applied without asking', () => {
  it('reads back what was written', () => {
    stubStorage();
    expect(lastAutoUpdate.read()).toBeNull();
    expect(lastAutoUpdate.write(1_234)).toBe(true);
    expect(lastAutoUpdate.read()).toBe(1_234);
  });

  it('treats anything that is not a time as never', () => {
    const data = stubStorage();
    data.set('gb:auto-update-at', JSON.stringify('yesterday'));
    expect(lastAutoUpdate.read()).toBeNull();
  });

  it('says so when it cannot be written down, and reads as never when storage is blocked', () => {
    stubStorage({
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      getItem: () => {
        throw new Error('SecurityError');
      },
    });
    expect(lastAutoUpdate.write(1)).toBe(false);
    expect(lastAutoUpdate.read()).toBeNull();
  });
});
