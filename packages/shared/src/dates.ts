/**
 * Expense days are plain local calendar dates ("YYYY-MM-DD"), never UTC instants,
 * so an expense entered at 00:30 IST never lands on the wrong day.
 */

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_KEY = /^(\d{4})-(\d{2})$/;

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** The local calendar date of `now` in the runtime's time zone. */
export function toLocalDate(now: Date = new Date()): string {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** True only for real calendar dates ("2024-02-29" yes, "2023-02-29" no). */
export function isValidLocalDate(value: string): boolean {
  const match = LOCAL_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

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

function parseLocalDate(date: string): { year: number; month: number; day: number } {
  const match = LOCAL_DATE.exec(date);
  if (!match) throw new RangeError(`Invalid date: ${date}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

const formatUtc = (time: Date) =>
  `${pad(time.getUTCFullYear(), 4)}-${pad(time.getUTCMonth() + 1)}-${pad(time.getUTCDate())}`;

/** Days in a calendar month (`month` is 1–12): (2024, 2) → 29. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Moves a date by `delta` days (negative goes back): ("2026-03-01", -1) → "2026-02-28". */
export function addDays(date: string, delta: number): string {
  const { year, month, day } = parseLocalDate(date);
  return formatUtc(new Date(Date.UTC(year, month - 1, day + delta)));
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const a = parseLocalDate(from);
  const b = parseLocalDate(to);
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000,
  );
}

/** The date `day` of a month, held at the month's last day when the month is shorter (31 → 30). */
export function dateInMonth(key: string, day: number): string {
  const { year, month } = parseMonthKey(key);
  return `${pad(year, 4)}-${pad(month)}-${pad(Math.min(day, daysInMonth(year, month)))}`;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Today's date in India (UTC+5:30, no daylight saving). The Worker runs in UTC, so anything
 * that must follow the calendar day the group lives in (recurring expenses) asks for this.
 */
export function toIndiaDate(now: Date = new Date()): string {
  return formatUtc(new Date(now.getTime() + IST_OFFSET_MS));
}
