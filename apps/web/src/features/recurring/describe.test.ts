import { describe, expect, it } from 'vitest';
import { describeNext, describeSchedule } from './describe';

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
