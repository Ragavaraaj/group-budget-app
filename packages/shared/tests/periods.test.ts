import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, daysInMonth, toIndiaDate } from '../src/dates';
import {
  fiscalYearLabel,
  fiscalYearOf,
  fiscalYearOfPeriod,
  fiscalYearPeriodKeys,
  fiscalYearRange,
  normaliseStartDay,
  periodKeyOf,
  periodRange,
} from '../src/periods';

const dateArb = fc
  .date({ min: new Date('2000-01-01'), max: new Date('2060-12-31'), noInvalidDate: true })
  .map((d) => d.toISOString().slice(0, 10));

describe('date helpers', () => {
  it('adds days across month, year and leap boundaries', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-10-02', 0)).toBe('2026-10-02');
  });

  it('counts days between dates in either direction', () => {
    expect(daysBetween('2026-10-01', '2026-10-31')).toBe(30);
    expect(daysBetween('2026-10-31', '2026-10-01')).toBe(-30);
    expect(daysBetween('2024-02-01', '2024-03-01')).toBe(29);
  });

  it('knows month lengths', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it('addDays and daysBetween agree', () => {
    fc.assert(
      fc.property(dateArb, fc.integer({ min: -4000, max: 4000 }), (date, delta) => {
        expect(daysBetween(date, addDays(date, delta))).toBe(delta);
      }),
    );
  });

  it('reads the calendar day in India, ahead of UTC by 5½ hours', () => {
    expect(toIndiaDate(new Date('2026-10-01T18:29:59Z'))).toBe('2026-10-01');
    expect(toIndiaDate(new Date('2026-10-01T18:30:00Z'))).toBe('2026-10-02');
    expect(toIndiaDate(new Date('2026-12-31T20:00:00Z'))).toBe('2027-01-01');
  });
});

describe('periods', () => {
  it('is the ordinary calendar month when the start day is 1', () => {
    expect(periodRange('2026-10')).toEqual({ start: '2026-10-01', endExclusive: '2026-11-01' });
    expect(periodKeyOf('2026-10-14')).toBe('2026-10');
  });

  it('runs from the start day to the day before it in the next month', () => {
    expect(periodRange('2026-10', 25)).toEqual({ start: '2026-10-25', endExclusive: '2026-11-25' });
    expect(periodRange('2026-12', 25)).toEqual({ start: '2026-12-25', endExclusive: '2027-01-25' });
  });

  it('puts the days before the start day in the previous period', () => {
    expect(periodKeyOf('2026-10-24', 25)).toBe('2026-09');
    expect(periodKeyOf('2026-10-25', 25)).toBe('2026-10');
    expect(periodKeyOf('2027-01-10', 25)).toBe('2026-12');
  });

  it('every date lies inside the range of the period it is put in', () => {
    fc.assert(
      fc.property(dateArb, fc.integer({ min: 1, max: 28 }), (date, startDay) => {
        const { start, endExclusive } = periodRange(periodKeyOf(date, startDay), startDay);
        expect(date >= start).toBe(true);
        expect(date < endExclusive).toBe(true);
      }),
    );
  });

  it('consecutive periods meet exactly with no gap or overlap', () => {
    fc.assert(
      fc.property(dateArb, fc.integer({ min: 1, max: 28 }), (date, startDay) => {
        const key = periodKeyOf(date, startDay);
        const { endExclusive } = periodRange(key, startDay);
        expect(periodKeyOf(endExclusive, startDay)).not.toBe(key);
        expect(periodKeyOf(addDays(endExclusive, -1), startDay)).toBe(key);
      }),
    );
  });

  it('turns anything odd into the 1st', () => {
    expect(normaliseStartDay(25)).toBe(25);
    expect(normaliseStartDay('7')).toBe(7);
    for (const odd of [0, 29, -3, 2.5, 'x', null, undefined, Number.NaN]) {
      expect(normaliseStartDay(odd)).toBe(1);
    }
  });
});

describe('Indian financial year', () => {
  it('runs April to March', () => {
    expect(fiscalYearOf('2026-04-01')).toBe(2026);
    expect(fiscalYearOf('2027-03-31')).toBe(2026);
    expect(fiscalYearOf('2026-03-31')).toBe(2025);
    expect(fiscalYearOfPeriod('2026-12')).toBe(2026);
    expect(fiscalYearOfPeriod('2027-01')).toBe(2026);
  });

  it('lists its twelve periods, April first', () => {
    const keys = fiscalYearPeriodKeys(2026);
    expect(keys).toHaveLength(12);
    expect(keys[0]).toBe('2026-04');
    expect(keys[8]).toBe('2026-12');
    expect(keys[11]).toBe('2027-03');
  });

  it('covers 1 April to 31 March', () => {
    expect(fiscalYearRange(2026)).toEqual({ start: '2026-04-01', endExclusive: '2027-04-01' });
  });

  it('follows a salary-cycle start day', () => {
    expect(fiscalYearRange(2026, 25)).toEqual({ start: '2026-04-25', endExclusive: '2027-04-25' });
    // 10 April falls in the cycle that began on 25 March, which belongs to the year before.
    expect(fiscalYearOf('2026-04-10', 25)).toBe(2025);
  });

  it('labels the year the way it is written in India', () => {
    expect(fiscalYearLabel(2026)).toBe('FY 2026–27');
    expect(fiscalYearLabel(2099)).toBe('FY 2099–00');
  });

  it('every date is inside the range of its own financial year', () => {
    fc.assert(
      fc.property(dateArb, fc.integer({ min: 1, max: 28 }), (date, startDay) => {
        const { start, endExclusive } = fiscalYearRange(fiscalYearOf(date, startDay), startDay);
        expect(date >= start && date < endExclusive).toBe(true);
      }),
    );
  });
});
