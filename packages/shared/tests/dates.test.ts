import { describe, expect, it } from 'vitest';
import { isValidLocalDate, toLocalDate } from '../src/dates';
import { addMonths, monthKey, monthRange } from '../src/months';

describe('toLocalDate', () => {
  it('uses local calendar fields, not UTC', () => {
    // Constructed from local fields, so this holds in any time zone.
    expect(toLocalDate(new Date(2026, 9, 2, 0, 30))).toBe('2026-10-02');
    expect(toLocalDate(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
  });
});

describe('isValidLocalDate', () => {
  it.each(['2024-02-29', '2026-10-02', '2000-12-31'])('accepts %s', (value) => {
    expect(isValidLocalDate(value)).toBe(true);
  });

  it.each(['2023-02-29', '2026-13-01', '2026-00-10', '2026-10-32', '2026-1-2', 'today', ''])(
    'rejects %j',
    (value) => {
      expect(isValidLocalDate(value)).toBe(false);
    },
  );
});

describe('month helpers', () => {
  it('extracts the month key', () => {
    expect(monthKey('2026-10-14')).toBe('2026-10');
  });

  it('computes half-open ranges, including December', () => {
    expect(monthRange('2026-10')).toEqual({ start: '2026-10-01', endExclusive: '2026-11-01' });
    expect(monthRange('2026-12')).toEqual({ start: '2026-12-01', endExclusive: '2027-01-01' });
  });

  it('moves across year boundaries in both directions', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2025-12', 1)).toBe('2026-01');
    expect(addMonths('2026-10', 14)).toBe('2027-12');
    expect(addMonths('2026-10', 0)).toBe('2026-10');
  });

  it('rejects malformed month keys', () => {
    expect(() => monthRange('2026-13')).toThrow(RangeError);
    expect(() => addMonths('nope', 1)).toThrow(RangeError);
  });
});
