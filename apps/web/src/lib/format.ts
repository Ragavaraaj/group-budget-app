import {
  addDays,
  addMonths,
  fiscalYearLabel,
  periodKeyOf,
  periodRange,
  toLocalDate,
} from '@budget/shared';

/** "2026-10-02" as local calendar parts. Never goes through a Date in UTC, so no off-by-one days. */
function parts(date: string): { y: number; m: number; d: number } {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  return { y, m, d };
}

const localDate = (date: string) => {
  const { y, m, d } = parts(date);
  return new Date(y, m - 1, d);
};

/** "Today", "Yesterday", or "Fri, 2 Oct" (with the year when it isn't this year). */
export function formatDay(date: string, today: string = toLocalDate()): string {
  if (date === today) return 'Today';
  const now = parts(today);
  const yesterday = toLocalDate(new Date(now.y, now.m - 1, now.d - 1));
  if (date === yesterday) return 'Yesterday';
  const sameYear = parts(date).y === now.y;
  return localDate(date).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** "2026-10" → "October 2026". */
export function formatMonth(key: string): string {
  return localDate(`${key}-01`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

/** The month key for today. */
export const currentMonth = () => toLocalDate().slice(0, 7);

/** "Oct", for a chart axis. */
export function formatMonthShort(key: string): string {
  return localDate(`${key}-01`).toLocaleDateString('en-IN', { month: 'short' });
}

const shortDate = (date: string, withYear: boolean) =>
  localDate(date).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
  });

/**
 * A reporting period's name: "October 2026" for a calendar month, "25 Oct – 24 Nov 2026" when
 * the month is set to start on another day.
 */
export function formatPeriod(key: string, startDay = 1): string {
  if (startDay === 1) return formatMonth(key);
  const { start, endExclusive } = periodRange(key, startDay);
  return `${shortDate(start, false)} – ${shortDate(addDays(endExclusive, -1), true)}`;
}

/** The period that contains today. */
export const currentPeriod = (startDay = 1) => periodKeyOf(toLocalDate(), startDay);

export { addMonths, fiscalYearLabel };

/** Initials for an avatar fallback: "Asha Rao" → "AR". */
export function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '');
  return letters.join('') || '?';
}

/** "just now", "5 min ago", "3 h ago", "Yesterday", or a date. `now` is injectable for tests. */
export function formatRelative(timestamp: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const then = new Date(timestamp);
  const days = Math.round((now - timestamp) / 86_400_000);
  if (days === 1) return 'Yesterday';
  return then.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    ...(then.getFullYear() === new Date(now).getFullYear() ? {} : { year: 'numeric' }),
  });
}
