import { describe, expect, it } from 'vitest';
import {
  describeNext,
  describeSchedule,
  joinNames,
  peopleWhoLeft,
} from '@/features/recurring/describe';

describe('describeSchedule', () => {
  it('says the weekday for a weekly rule', () => {
    expect(describeSchedule({ frequency: 'weekly', startOn: '2026-10-02' })).toBe(
      'Every week on Friday',
    );
  });

  it('says the day for a monthly rule, with the right ordinal', () => {
    const monthly = (day: string) =>
      describeSchedule({ frequency: 'monthly', startOn: `2026-10-${day}` });
    expect(monthly('01')).toBe('Every month on the 1st');
    expect(monthly('02')).toBe('Every month on the 2nd');
    expect(monthly('03')).toBe('Every month on the 3rd');
    expect(monthly('11')).toBe('Every month on the 11th');
    expect(monthly('22')).toBe('Every month on the 22nd');
  });

  it('warns that the 29th to the 31st fall back in shorter months', () => {
    expect(describeSchedule({ frequency: 'monthly', startOn: '2026-10-31' })).toMatch(
      /31st \(the last day in shorter months\)/,
    );
  });

  it('says the date for a yearly rule', () => {
    expect(describeSchedule({ frequency: 'yearly', startOn: '2026-10-02' })).toBe(
      'Every year on 2 Oct',
    );
  });
});

describe('describeNext', () => {
  const rule = { frequency: 'monthly' as const, startOn: '2026-10-01', endOn: null };
  const format = (date: string) => `on ${date}`;

  it('names the next date', () => {
    expect(describeNext({ ...rule, active: true, lastGeneratedOn: null }, format)).toBe(
      'Next: on 2026-10-01',
    );
    expect(describeNext({ ...rule, active: true, lastGeneratedOn: '2026-10-01' }, format)).toBe(
      'Next: on 2026-11-01',
    );
  });

  it('says so when paused or finished', () => {
    expect(describeNext({ ...rule, active: false, lastGeneratedOn: null }, format)).toBe('Paused');
    expect(
      describeNext(
        { ...rule, endOn: '2026-10-31', active: true, lastGeneratedOn: '2026-10-01' },
        format,
      ),
    ).toBe('Finished');
  });
});

describe('peopleWhoLeft', () => {
  const members = [
    { userId: 'a', displayName: 'Asha', removedAt: null },
    { userId: 'r', displayName: 'Ravi', removedAt: 100 },
    { userId: 'm', displayName: 'Meera', removedAt: 200 },
  ];
  const rule = (ids: string[]) => ({
    payers: [{ userId: 'a' }],
    shares: ids.map((userId) => ({ userId })),
  });

  it('names the people in the split who have left, and nobody else', () => {
    expect(peopleWhoLeft(rule(['a', 'r', 'm']), 'a', members)).toEqual({
      inSplit: ['Ravi', 'Meera'],
      creator: null,
    });
    expect(peopleWhoLeft(rule(['a']), 'a', members)).toEqual({ inSplit: [], creator: null });
  });

  it('says when the person who set the rule up has left', () => {
    expect(peopleWhoLeft(rule(['a']), 'r', members)).toEqual({ inSplit: [], creator: 'Ravi' });
  });

  it('counts a person once even if they pay and owe', () => {
    const paying = { payers: [{ userId: 'r' }], shares: [{ userId: 'r' }] };
    expect(peopleWhoLeft(paying, 'a', members).inSplit).toEqual(['Ravi']);
  });
});

describe('joinNames', () => {
  it('reads like a sentence', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['Asha'])).toBe('Asha');
    expect(joinNames(['Asha', 'Ravi'])).toBe('Asha and Ravi');
    expect(joinNames(['Asha', 'Ravi', 'Meera'])).toBe('Asha, Ravi and Meera');
  });
});
