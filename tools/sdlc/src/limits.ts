/**
 * Telling a usage limit apart from a real failure, from the execution log the Claude action
 * writes, and working out when to try again. A subscription's limit resets on its own, so the
 * pipeline pauses and resumes instead of failing.
 */

export type RunKind =
  | 'ok'
  | 'usage_limit'
  | 'overloaded'
  | 'model_unavailable'
  | 'max_turns'
  | 'error'
  | 'no_log';

export interface RunVerdict {
  kind: RunKind;
  /** When the limit resets, if the message said. */
  resetAt: Date | null;
  message: string;
  sessionId: string | null;
}

const USAGE_LIMIT = [
  /usage limit/i,
  /limit reached/i,
  /hit your (?:usage )?limit/i,
  /out of (?:extra )?usage/i,
];
/** A plain 429 is a usage limit when it says when it resets, and a short backoff when not. */
const RATE_LIMITED = [/rate_limit_error/i, /\b429\b/];
const OVERLOADED = [/overloaded/i, /\b529\b/];
const MODEL_UNAVAILABLE = [
  /model[^.\n]{0,80}not (?:available|supported|found)/i,
  /(?:no|not have) access to (?:the )?model/i,
  /invalid model/i,
];

interface LogEntry {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: unknown;
  session_id?: string;
  error?: unknown;
  message?: { content?: unknown };
}

function textOf(entry: LogEntry): string {
  const parts: string[] = [];
  if (typeof entry.result === 'string') parts.push(entry.result);
  if (typeof entry.error === 'string') parts.push(entry.error);
  const content = entry.message?.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      const text = (block as { text?: unknown })?.text;
      if (typeof text === 'string') parts.push(text);
    }
  } else if (typeof content === 'string') {
    parts.push(content);
  }
  return parts.join('\n');
}

export function classifyRun(log: unknown, now: Date): RunVerdict {
  if (!Array.isArray(log) || log.length === 0) {
    return {
      kind: 'no_log',
      resetAt: null,
      message: 'The run left no execution log.',
      sessionId: null,
    };
  }
  const entries = log as LogEntry[];
  const sessionId = entries.find((e) => typeof e?.session_id === 'string')?.session_id ?? null;
  const result = [...entries].reverse().find((e) => e?.type === 'result');

  if (result && result.is_error !== true && result.subtype === 'success') {
    return { kind: 'ok', resetAt: null, message: '', sessionId };
  }

  // Only the end of the run decides: an early 429 that was retried is not a limit.
  const tail = entries.slice(-6).map(textOf).join('\n');
  const message =
    (result ? textOf(result) : tail).trim().slice(0, 500) || 'The run ended with an error.';

  if (MODEL_UNAVAILABLE.some((re) => re.test(tail))) {
    return { kind: 'model_unavailable', resetAt: null, message, sessionId };
  }
  if (USAGE_LIMIT.some((re) => re.test(tail))) {
    return { kind: 'usage_limit', resetAt: parseReset(tail, now), message, sessionId };
  }
  if (RATE_LIMITED.some((re) => re.test(tail))) {
    const resetAt = parseReset(tail, now);
    return { kind: resetAt ? 'usage_limit' : 'overloaded', resetAt, message, sessionId };
  }
  if (OVERLOADED.some((re) => re.test(tail))) {
    return { kind: 'overloaded', resetAt: null, message, sessionId };
  }
  if (result?.subtype === 'error_max_turns') {
    return { kind: 'max_turns', resetAt: null, message, sessionId };
  }
  return { kind: 'error', resetAt: null, message, sessionId };
}

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * Finds the reset time in a limit message. Two shapes are known: an epoch after a bar
 * ("…limit reached|1760000000"), and a wall-clock time with an optional day and time zone
 * ("resets 3pm (Asia/Kolkata)", "resets Mon 9:30am", "resets at 15:00").
 */
export function parseReset(text: string, now: Date): Date | null {
  const epoch = /\|(\d{10})\b/.exec(text);
  if (epoch?.[1]) return new Date(Number(epoch[1]) * 1000);

  const wall =
    /resets?\s+(?:at\s+)?(?:(sun|mon|tue|wed|thu|fri|sat)[a-z]*\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\(([^)]+)\))?/i.exec(
      text,
    );
  if (!wall?.[2]) return null;
  let hour = Number(wall[2]);
  const minute = wall[3] ? Number(wall[3]) : 0;
  const meridiem = wall[4]?.toLowerCase();
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  const zone = validZone(wall[5]?.trim()) ?? 'UTC';
  const day = wall[1] ? DAYS.indexOf(wall[1].toLowerCase()) : null;
  return nextWallTime(now, hour, minute, zone, day);
}

function validZone(zone: string | undefined): string | null {
  if (!zone) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

/** The wall-clock parts of an instant in a time zone. */
function partsIn(instant: Date, zone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    weekday: DAYS.indexOf(get('weekday').toLowerCase().slice(0, 3)),
  };
}

/** The instant at which the clock in `zone` shows this date and time. */
function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  zone: string,
): Date {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  const offsetAt = (instant: number) => {
    const p = partsIn(new Date(instant), zone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - instant;
  };
  let utc = asUtc - offsetAt(asUtc);
  // Near a daylight-saving change the first guess can be an hour out; one correction settles it.
  const corrected = asUtc - offsetAt(utc);
  if (corrected !== utc) utc = corrected;
  return new Date(utc);
}

function nextWallTime(
  now: Date,
  hour: number,
  minute: number,
  zone: string,
  weekday: number | null,
): Date {
  const today = partsIn(now, zone);
  for (let ahead = 0; ahead <= 7; ahead++) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + ahead));
    if (weekday !== null && date.getUTCDay() !== weekday) continue;
    const candidate = zonedToUtc(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
      hour,
      minute,
      zone,
    );
    if (candidate.getTime() > now.getTime()) return candidate;
  }
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}

const MINUTE = 60 * 1000;
/** Without a reset time: 30 minutes, 1 hour, 2 hours, then every 5 hours. */
const LIMIT_BACKOFF = [30 * MINUTE, 60 * MINUTE, 120 * MINUTE, 300 * MINUTE];

/** When to try again after a usage limit. `attempt` counts limits hit in a row, from 0. */
export function nextResume(now: Date, resetAt: Date | null, attempt: number): Date {
  if (resetAt && resetAt.getTime() > now.getTime()) {
    // A little after the reset, so the first run isn't refused by a clock a few seconds behind.
    return new Date(resetAt.getTime() + 2 * MINUTE);
  }
  const wait = LIMIT_BACKOFF[Math.min(attempt, LIMIT_BACKOFF.length - 1)] ?? 300 * MINUTE;
  return new Date(now.getTime() + wait);
}

/** A short wait for one card after an overloaded API: 10, 20, then 30 minutes. */
export function overloadedRetry(now: Date, attempt: number): Date {
  return new Date(now.getTime() + Math.min(attempt + 1, 3) * 10 * MINUTE);
}
