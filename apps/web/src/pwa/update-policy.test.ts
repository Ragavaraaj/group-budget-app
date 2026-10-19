import { describe, expect, it } from 'vitest';
import {
  AUTO_UPDATE_COOLDOWN_MS,
  mayReloadNow,
  STARTUP_WINDOW_MS,
  shouldApplyAtStartup,
  type UpdateMoment,
} from './update-policy';

/** Right after the app opened, in an otherwise quiet browser: the one case that is applied. */
const QUIET: UpdateMoment = {
  openedForMs: 800,
  sinceLastAutoUpdateMs: null,
  userHasInteracted: false,
  signInPending: false,
};

describe('applying an update without asking', () => {
  it('applies one found right after the app opened, with nothing entered', () => {
    expect(shouldApplyAtStartup(QUIET)).toBe(true);
    expect(shouldApplyAtStartup({ ...QUIET, openedForMs: STARTUP_WINDOW_MS })).toBe(true);
  });

  const asks: [string, Partial<UpdateMoment>][] = [
    ['found later, in a tab left open', { openedForMs: STARTUP_WINDOW_MS + 1 }],
    ['found hours in', { openedForMs: 3 * 60 * 60_000 }],
    ['the person has already tapped or typed', { userHasInteracted: true }],
    ['a sign-in is waiting to be collected', { signInPending: true }],
    ['another update was applied just now', { sinceLastAutoUpdateMs: 2_000 }],
    [
      'another update was applied exactly one cooldown ago',
      { sinceLastAutoUpdateMs: AUTO_UPDATE_COOLDOWN_MS },
    ],
  ];
  it.each(asks)('asks instead when %s', (_why, change) => {
    expect(shouldApplyAtStartup({ ...QUIET, ...change })).toBe(false);
  });

  it('applies again once enough time has passed since the last automatic update', () => {
    expect(
      shouldApplyAtStartup({ ...QUIET, sinceLastAutoUpdateMs: AUTO_UPDATE_COOLDOWN_MS + 1 }),
    ).toBe(true);
  });

  it('treats a last-update time in the future (the clock was set back) as long ago', () => {
    // Otherwise a time written while the clock was ahead would switch this off until it caught up.
    expect(shouldApplyAtStartup({ ...QUIET, sinceLastAutoUpdateMs: -5_000 })).toBe(true);
    expect(shouldApplyAtStartup({ ...QUIET, sinceLastAutoUpdateMs: -3 * 60 * 60_000 })).toBe(true);
  });
});

describe('whether a tab may reload when the new version takes over', () => {
  const quiet = { askedToReload: false, userHasInteracted: false, signInPending: false };

  it('reloads a tab nothing has been done in', () => {
    expect(mayReloadNow(quiet)).toBe(true);
  });

  it('holds back a tab that has been used, or is waiting for a sign-in, and offers instead', () => {
    expect(mayReloadNow({ ...quiet, userHasInteracted: true })).toBe(false);
    expect(mayReloadNow({ ...quiet, signInPending: true })).toBe(false);
    expect(mayReloadNow({ ...quiet, userHasInteracted: true, signInPending: true })).toBe(false);
  });

  it('never holds back a reload the person asked for', () => {
    expect(
      mayReloadNow({ askedToReload: true, userHasInteracted: true, signInPending: true }),
    ).toBe(true);
  });
});
