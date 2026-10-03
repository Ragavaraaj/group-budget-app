/** Month keys ("YYYY-MM") name a calendar month; these move between months and around in one. */

const MONTH_KEY = /^(\d{4})-(\d{2})$/;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** "2026-10-14" → "2026-10". */
export function monthKey(date: string): string {
  return date.slice(0, 7);
}

function parseMonthKey(key: string): { year: number; month: number } {
  const match = MONTH_KEY.exec(key);
  if (!match) throw new RangeError(`Invalid month key: ${key}`);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new RangeError(`Invalid month key: ${key}`);
  return { year: Number(match[1]), month };
}

/** First day of the month and the first day of the next month (exclusive end). */
export function monthRange(key: string): { start: string; endExclusive: string } {
  const { year, month } = parseMonthKey(key);
  const next = addMonths(key, 1);
  return { start: `${pad(year, 4)}-${pad(month)}-01`, endExclusive: `${next}-01` };
}

/** Moves a month key by `delta` months (negative goes back): ("2026-01", -1) → "2025-12". */
export function addMonths(key: string, delta: number): string {
  const { year, month } = parseMonthKey(key);
  const index = year * 12 + (month - 1) + delta;
  return `${pad(Math.floor(index / 12), 4)}-${pad((index % 12) + 1)}`;
}

/** Days in a calendar month (`month` is 1–12): (2024, 2) → 29. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The date `day` of a month, held at the month's last day when the month is shorter (31 → 30). */
export function dateInMonth(key: string, day: number): string {
  const { year, month } = parseMonthKey(key);
  return `${pad(year, 4)}-${pad(month)}-${pad(Math.min(day, daysInMonth(year, month)))}`;
}
