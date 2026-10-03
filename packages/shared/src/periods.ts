import { addMonths, dateInMonth, monthKey } from './months';

/**
 * Reporting periods. A "month" normally starts on the 1st, but people who live on a salary
 * cycle want it to start on the day the money arrives. A period is named by the month it STARTS
 * in, so with a start day of 1 its key is the ordinary month key ("2026-10"), and with a start
 * day of 25 the key "2026-10" means 25 October to 24 November.
 *
 * The start day stops at 28 so every month has it.
 */

export const DEFAULT_MONTH_START_DAY = 1;
export const MAX_MONTH_START_DAY = 28;

/** Whatever was stored or typed, as a valid start day (anything odd becomes the 1st). */
export function normaliseStartDay(value: unknown): number {
  const day = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(day) || day < DEFAULT_MONTH_START_DAY || day > MAX_MONTH_START_DAY) {
    return DEFAULT_MONTH_START_DAY;
  }
  return day;
}

/** First day of the period and the first day after it. */
export function periodRange(
  key: string,
  startDay: number = DEFAULT_MONTH_START_DAY,
): { start: string; endExclusive: string } {
  return {
    start: dateInMonth(key, startDay),
    endExclusive: dateInMonth(addMonths(key, 1), startDay),
  };
}

/** The period a date falls in: ("2026-10-24", 25) → "2026-09"; ("2026-10-25", 25) → "2026-10". */
export function periodKeyOf(date: string, startDay: number = DEFAULT_MONTH_START_DAY): string {
  const key = monthKey(date);
  const day = Number(date.slice(8, 10));
  return day >= startDay ? key : addMonths(key, -1);
}

// --- Indian financial year: 1 April to 31 March ----------------------------------------------

/** The financial year a period belongs to, named by the year it starts in (2026 = FY 2026–27). */
export function fiscalYearOfPeriod(key: string): number {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  return month >= 4 ? year : year - 1;
}

export function fiscalYearOf(date: string, startDay: number = DEFAULT_MONTH_START_DAY): number {
  return fiscalYearOfPeriod(periodKeyOf(date, startDay));
}

/** The twelve period keys of a financial year, April first. */
export function fiscalYearPeriodKeys(fiscalYear: number): string[] {
  const first = `${String(fiscalYear).padStart(4, '0')}-04`;
  return Array.from({ length: 12 }, (_, i) => addMonths(first, i));
}

export function fiscalYearRange(
  fiscalYear: number,
  startDay: number = DEFAULT_MONTH_START_DAY,
): { start: string; endExclusive: string } {
  const keys = fiscalYearPeriodKeys(fiscalYear);
  return {
    start: periodRange(keys[0] as string, startDay).start,
    endExclusive: periodRange(keys[11] as string, startDay).endExclusive,
  };
}

/** "FY 2026–27". */
export function fiscalYearLabel(fiscalYear: number): string {
  return `FY ${fiscalYear}–${String((fiscalYear + 1) % 100).padStart(2, '0')}`;
}
