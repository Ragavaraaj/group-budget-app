import { describe, expect, it } from 'vitest';
import {
  AUTO_UPDATE_COOLDOWN_MS,
  STARTUP_WINDOW_MS,
  shouldApplyAtStartup,
  type UpdateMoment,
} from './update-policy';

/** Right after the app opened, in an otherwise quiet browser: the one case that is applied. */
const QUIET: UpdateMoment = {
  openedForMs: 800,
  sinceLastAutoUpdateMs: null,
  userHasInteracted: false,
  otherTabsOpen: false,
  signInPending: false,
};

describe('applying an update without asking', () => {
  it('applies one found right after the app opened, with nothing entered and no other tab', () => {
    expect(shouldApplyAtStartup(QUIET)).toBe(true);
    expect(shouldApplyAtStartup({ ...QUIET, openedForMs: STARTUP_WINDOW_MS })).toBe(true);
  });

  const asks: [string, Partial<UpdateMoment>][] = [
    ['found later, in a tab left open', { openedForMs: STARTUP_WINDOW_MS + 1 }],
    ['found hours in', { openedForMs: 3 * 60 * 60_000 }],
    ['the person has already tapped or typed', { userHasInteracted: true }],
    ['a sign-in is waiting to be collected', { signInPending: true }],
    ['another tab is open (it would be reloaded too)', { otherTabsOpen: true }],
    ['the browser cannot say whether another tab is open', { otherTabsOpen: null }],
    ['another update was applied just now', { sinceLastAutoUpdateMs: 2_000 }],
    [
      'another update was applied exactly one cooldown ago',
      { sinceLastAutoUpdateMs: AUTO_UPDATE_COOLDOWN_MS },
    ],
    ['the clock was set back since the last one', { sinceLastAutoUpdateMs: -5_000 }],
  ];
  it.each(asks)('asks instead when %s', (_why, change) => {
    expect(shouldApplyAtStartup({ ...QUIET, ...change })).toBe(false);
  });

  it('applies again once enough time has passed since the last automatic update', () => {
    expect(
      shouldApplyAtStartup({ ...QUIET, sinceLastAutoUpdateMs: AUTO_UPDATE_COOLDOWN_MS + 1 }),
    ).toBe(true);
  });
});
