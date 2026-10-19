import { describe, expect, it } from 'vitest';
import { formatDay, formatMonth, formatRelative, initials } from '@/lib/format';

describe('formatDay', () => {
  it('says Today and Yesterday', () => {
    expect(formatDay('2026-10-02', '2026-10-02')).toBe('Today');
    expect(formatDay('2026-10-01', '2026-10-02')).toBe('Yesterday');
    expect(formatDay('2026-09-30', '2026-10-01')).toBe('Yesterday');
  });

  it('shows the weekday and date otherwise, with the year only when it is not this year', () => {
    expect(formatDay('2026-09-25', '2026-10-02')).toMatch(/Fri.*25.*Sep/);
    expect(formatDay('2026-09-25', '2026-10-02')).not.toMatch(/2026/);
    expect(formatDay('2025-12-25', '2026-10-02')).toMatch(/2025/);
  });

  it('keeps the calendar day whatever the time zone', () => {
    // A date built in UTC would slip to the previous day in zones behind UTC.
    expect(formatDay('2026-01-01', '2026-06-01')).toMatch(/Thu.*1.*Jan/);
  });
});

describe('formatMonth', () => {
  it('names the month', () => {
    expect(formatMonth('2026-10')).toBe('October 2026');
    expect(formatMonth('2026-01')).toBe('January 2026');
  });
});

describe('initials', () => {
  it.each([
    ['Asha Rao', 'AR'],
    ['  bala  ', 'B'],
    ['A B C', 'AB'],
    ['', '?'],
  ])('%j → %j', (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});

describe('formatRelative', () => {
  const now = Date.UTC(2026, 9, 2, 12, 0, 0);
  it.each([
    [0, 'just now'],
    [30_000, 'just now'],
    [5 * 60_000, '5 min ago'],
    [59 * 60_000, '59 min ago'],
    [3 * 3_600_000, '3 h ago'],
    [30 * 3_600_000, 'Yesterday'],
  ])('%i ms ago → %s', (ago, expected) => {
    expect(formatRelative(now - ago, now)).toBe(expected);
  });

  it('uses a date once it is older than a day or two', () => {
    expect(formatRelative(now - 10 * 86_400_000, now)).toMatch(/22.*Sep/);
    expect(formatRelative(now - 400 * 86_400_000, now)).toMatch(/2025/);
  });
});
