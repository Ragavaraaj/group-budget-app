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

/**
 * The people a rule depends on who have left its group: those named in its split, and the person
 * who set it up. The server holds such a rule back (it would add to the debt of someone who can't
 * see the group, or answer to no one), until a member edits it, so the screens say so.
 */
export function peopleWhoLeft(
  rule: { payers: readonly { userId: string }[]; shares: readonly { userId: string }[] },
  creatorId: string,
  members: readonly { userId: string; displayName: string; removedAt: number | null }[],
): { inSplit: string[]; creator: string | null } {
  const left = new Map(members.filter((m) => m.removedAt !== null).map((m) => [m.userId, m]));
  const named = new Set([...rule.payers, ...rule.shares].map((p) => p.userId));
  return {
    inSplit: [...named].flatMap((id) => left.get(id)?.displayName ?? []),
    creator: left.get(creatorId)?.displayName ?? null,
  };
}

/** "Asha", "Asha and Ravi", "Asha, Ravi and Meera". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}
