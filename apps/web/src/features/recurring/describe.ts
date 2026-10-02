import { nextOccurrence, type Recurrence, type Schedule } from '@budget/shared';

const ordinal = (n: number) => {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
};

const parts = (date: string) => {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  return { y, m, d };
};

/** "Every week on Friday", "Every month on the 5th", "Every year on 2 Oct". */
export function describeSchedule(schedule: Pick<Schedule, 'frequency' | 'startOn'>): string {
  const { y, m, d } = parts(schedule.startOn);
  switch (schedule.frequency) {
    case 'weekly':
      return `Every week on ${new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'long' })}`;
    case 'monthly':
      return d > 28
        ? `Every month on the ${ordinal(d)} (the last day in shorter months)`
        : `Every month on the ${ordinal(d)}`;
    case 'yearly':
      return `Every year on ${new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
  }
}

export const FREQUENCY_LABELS: Record<Recurrence, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

/** What a rule will do next, in words. */
export function describeNext(
  rule: Schedule & { active: boolean; lastGeneratedOn: string | null },
  format: (date: string) => string,
): string {
  if (!rule.active) return 'Paused';
  const next = nextOccurrence(rule, rule.lastGeneratedOn);
  return next === null ? 'Finished' : `Next: ${format(next)}`;
}
