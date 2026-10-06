import { describe, expect, it } from 'vitest';
import { AUTO_UPDATE_COOLDOWN_MS, STARTUP_WINDOW_MS, shouldApplyAtStartup } from './update-policy';

describe('applying an update without asking', () => {
  it('applies one found right after the app opened', () => {
    expect(shouldApplyAtStartup({ openedForMs: 800, sinceLastAutoUpdateMs: null })).toBe(true);
    expect(
      shouldApplyAtStartup({ openedForMs: STARTUP_WINDOW_MS, sinceLastAutoUpdateMs: null }),
    ).toBe(true);
  });

  it('leaves one found later to the person, so it never replaces a form being filled in', () => {
    expect(
      shouldApplyAtStartup({ openedForMs: STARTUP_WINDOW_MS + 1, sinceLastAutoUpdateMs: null }),
    ).toBe(false);
    expect(
      shouldApplyAtStartup({ openedForMs: 3 * 60 * 60_000, sinceLastAutoUpdateMs: null }),
    ).toBe(false);
  });

  it('never reloads twice in a row: a second update straight after the first is asked about', () => {
    expect(shouldApplyAtStartup({ openedForMs: 500, sinceLastAutoUpdateMs: 2_000 })).toBe(false);
    expect(
      shouldApplyAtStartup({ openedForMs: 500, sinceLastAutoUpdateMs: AUTO_UPDATE_COOLDOWN_MS }),
    ).toBe(false);
  });

  it('applies again once enough time has passed since the last automatic update', () => {
    expect(
      shouldApplyAtStartup({
        openedForMs: 500,
        sinceLastAutoUpdateMs: AUTO_UPDATE_COOLDOWN_MS + 1,
      }),
    ).toBe(true);
  });
});
