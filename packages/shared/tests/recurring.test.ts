import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isUuid } from '../src/ids';
import {
  countDue,
  nextOccurrence,
  nthOccurrence,
  occurrencesAfter,
  recurringExpenseId,
  type Schedule,
} from '../src/recurring';

const monthly = (startOn: string, endOn: string | null = null): Schedule => ({
  frequency: 'monthly',
  startOn,
  endOn,
});

describe('nthOccurrence', () => {
  it('weekly repeats every seven days', () => {
    const rule: Schedule = { frequency: 'weekly', startOn: '2026-10-02', endOn: null };
    expect([0, 1, 2, 5].map((k) => nthOccurrence(rule, k))).toEqual([
      '2026-10-02',
      '2026-10-09',
      '2026-10-16',
      '2026-11-06',
    ]);
  });

  it('monthly keeps the day, and falls on the last day of a shorter month', () => {
    const rule = monthly('2026-01-31');
    expect([0, 1, 2, 3].map((k) => nthOccurrence(rule, k))).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
    expect(nthOccurrence(monthly('2026-12-15'), 2)).toBe('2027-02-15');
  });

  it('yearly keeps the day, and 29 February becomes the 28th in other years', () => {
    const rule: Schedule = { frequency: 'yearly', startOn: '2024-02-29', endOn: null };
    expect([0, 1, 4].map((k) => nthOccurrence(rule, k))).toEqual([
      '2024-02-29',
      '2025-02-28',
      '2028-02-29',
    ]);
  });
});

describe('occurrencesAfter', () => {
  it('lists what is due up to a date, oldest first', () => {
    expect(occurrencesAfter(monthly('2026-08-01'), null, '2026-10-02', 10)).toEqual([
      '2026-08-01',
      '2026-09-01',
      '2026-10-01',
    ]);
  });

  it('skips what was already made', () => {
    expect(occurrencesAfter(monthly('2026-08-01'), '2026-09-01', '2026-10-02', 10)).toEqual([
      '2026-10-01',
    ]);
  });

  it('includes today and excludes tomorrow', () => {
    expect(occurrencesAfter(monthly('2026-10-02'), null, '2026-10-02', 10)).toEqual(['2026-10-02']);
    expect(occurrencesAfter(monthly('2026-10-03'), null, '2026-10-02', 10)).toEqual([]);
  });

  it('stops at the end date and at the limit', () => {
    expect(occurrencesAfter(monthly('2026-01-01', '2026-03-15'), null, '2026-12-31', 10)).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
    ]);
    expect(occurrencesAfter(monthly('2026-01-01'), null, '2026-12-31', 2)).toEqual([
      '2026-01-01',
      '2026-02-01',
    ]);
  });

  it('counts what is due', () => {
    expect(countDue(monthly('2026-08-01'), null, '2026-10-02')).toBe(3);
    expect(countDue(monthly('2026-08-01'), '2026-10-01', '2026-10-02')).toBe(0);
  });

  it('never repeats a date and keeps them in order, whatever the rule', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('weekly', 'monthly', 'yearly'),
        fc
          .date({ min: new Date('2020-01-01'), max: new Date('2030-12-31'), noInvalidDate: true })
          .map((d) => d.toISOString().slice(0, 10)),
        (frequency, startOn) => {
          const dates = occurrencesAfter(
            { frequency, startOn, endOn: null },
            null,
            '2035-01-01',
            60,
          );
          expect(dates[0]).toBe(startOn);
          for (let i = 1; i < dates.length; i++) {
            expect((dates[i] as string) > (dates[i - 1] as string)).toBe(true);
          }
        },
      ),
    );
  });
});

describe('nextOccurrence', () => {
  it('is the first date after the last one made', () => {
    expect(nextOccurrence(monthly('2026-08-01'), null)).toBe('2026-08-01');
    expect(nextOccurrence(monthly('2026-08-01'), '2026-10-01')).toBe('2026-11-01');
  });

  it('is null once the rule has ended', () => {
    expect(nextOccurrence(monthly('2026-08-01', '2026-10-31'), '2026-10-01')).toBeNull();
  });
});

describe('recurringExpenseId', () => {
  it('is a valid id, the same every time for the same rule and date', async () => {
    const id = await recurringExpenseId('019a0000-0000-7000-8000-000000000001', '2026-10-01');
    expect(isUuid(id)).toBe(true);
    expect(await recurringExpenseId('019a0000-0000-7000-8000-000000000001', '2026-10-01')).toBe(id);
  });

  it('differs by rule and by date', async () => {
    const ruleA = '019a0000-0000-7000-8000-000000000001';
    const ruleB = '019a0000-0000-7000-8000-000000000002';
    const ids = new Set([
      await recurringExpenseId(ruleA, '2026-10-01'),
      await recurringExpenseId(ruleA, '2026-11-01'),
      await recurringExpenseId(ruleB, '2026-10-01'),
    ]);
    expect(ids.size).toBe(3);
  });
});
