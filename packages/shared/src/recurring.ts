import { sha256Hex } from './crypto';
import { addDays, addMonths, dateInMonth, daysBetween } from './dates';

/**
 * Recurring expenses: a rule says "this, every week / month / year, from this date". The
 * Worker's scheduled job turns due occurrences into ordinary expenses. The date maths lives
 * here, shared, so the screen can show "next on 1 Nov" with the same answer the server uses.
 */

export const RECURRENCES = ['weekly', 'monthly', 'yearly'] as const;
export type Recurrence = (typeof RECURRENCES)[number];

export interface Schedule {
  frequency: Recurrence;
  /** The first occurrence, which also fixes the weekday / day of the month / day of the year. */
  startOn: string;
  /** No occurrences after this date; `null` runs for ever. */
  endOn: string | null;
}

const MAX_STEPS = 10_000;

/**
 * The k-th occurrence (k = 0 is the start date). A monthly rule on the 31st falls on the last day
 * of shorter months, and a yearly rule on 29 February on the 28th in other years.
 */
export function nthOccurrence(schedule: Schedule, k: number): string {
  const { frequency, startOn } = schedule;
  const key = startOn.slice(0, 7);
  const day = Number(startOn.slice(8, 10));
  switch (frequency) {
    case 'weekly':
      return addDays(startOn, 7 * k);
    case 'monthly':
      return dateInMonth(addMonths(key, k), day);
    case 'yearly':
      return dateInMonth(addMonths(key, 12 * k), day);
  }
}

/**
 * Occurrences after `after` (null = from the start) up to and including `through`, oldest first,
 * at most `limit` of them. Never goes past the rule's end date.
 */
export function occurrencesAfter(
  schedule: Schedule,
  after: string | null,
  through: string,
  limit: number,
): string[] {
  const last = schedule.endOn !== null && schedule.endOn < through ? schedule.endOn : through;
  const dates: string[] = [];
  for (let k = 0; k < MAX_STEPS && dates.length < limit; k++) {
    const date = nthOccurrence(schedule, k);
    if (date > last) break;
    if (after === null || date > after) dates.push(date);
  }
  return dates;
}

/** The next occurrence after `after` (null = the first), or null when the rule has ended. */
export function nextOccurrence(schedule: Schedule, after: string | null): string | null {
  for (let k = 0; k < MAX_STEPS; k++) {
    const date = nthOccurrence(schedule, k);
    if (schedule.endOn !== null && date > schedule.endOn) return null;
    if (after === null || date > after) return date;
  }
  return null;
}

/** How many occurrences fall on or before `through` and after `after`, for "creates N expenses now". */
export function countDue(schedule: Schedule, after: string | null, through: string): number {
  return occurrencesAfter(schedule, after, through, MAX_STEPS).length;
}

/**
 * The id of the expense a rule creates for one date. It is derived from the rule and the date
 * rather than random, so if the job ever runs twice for the same occurrence it writes the same
 * row both times and no duplicate appears. (UUID version 8 is the "custom" version.)
 */
export async function recurringExpenseId(ruleId: string, date: string): Promise<string> {
  const hex = (await sha256Hex(`recurring:${ruleId}:${date}`)).slice(0, 32).split('');
  hex[12] = '8';
  hex[16] = '89ab'[Number.parseInt(hex[16] as string, 16) % 4] as string;
  const id = hex.join('');
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

/** Days from `from` to the next occurrence, for "in 3 days". */
export function daysUntilNext(
  schedule: Schedule,
  after: string | null,
  today: string,
): number | null {
  const next = nextOccurrence(schedule, after);
  return next === null ? null : daysBetween(today, next);
}
