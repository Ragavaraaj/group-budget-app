import { describe, expect, it } from 'vitest';
import { classifyRun, nextResume, overloadedRetry, parseReset } from '../src/limits.ts';

const NOW = new Date('2026-10-19T09:00:00Z'); // 14:30 in India, a Monday

function log(result: string, extra: Record<string, unknown> = {}) {
  return [
    { type: 'system', subtype: 'init', session_id: 'sess-1' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Working on it.' }] } },
    { type: 'result', subtype: 'error_during_execution', is_error: true, result, ...extra },
  ];
}

describe('classifyRun', () => {
  it('reports a successful run and its session', () => {
    const verdict = classifyRun(
      [
        { type: 'system', session_id: 'sess-9' },
        { type: 'result', subtype: 'success', is_error: false, result: 'done' },
      ],
      NOW,
    );
    expect(verdict).toMatchObject({ kind: 'ok', sessionId: 'sess-9' });
  });

  it('treats a missing or empty log as its own case', () => {
    expect(classifyRun(null, NOW).kind).toBe('no_log');
    expect(classifyRun([], NOW).kind).toBe('no_log');
  });

  it.each([
    'Claude AI usage limit reached|1760868000',
    "You've hit your limit · resets 3pm (Asia/Kolkata)",
    '5-hour limit reached ∙ resets 4:30pm',
    'Weekly limit reached · resets Mon 9am (UTC)',
    'You are out of extra usage',
  ])('recognises the usage limit in %j', (message) => {
    const verdict = classifyRun(log(message), NOW);
    expect(verdict.kind).toBe('usage_limit');
    expect(verdict.sessionId).toBe('sess-1');
  });

  it('reads the reset time when the limit message gives one', () => {
    const verdict = classifyRun(log("You've hit your limit · resets 3pm (Asia/Kolkata)"), NOW);
    expect(verdict.resetAt?.toISOString()).toBe('2026-10-19T09:30:00.000Z');
  });

  it('counts a 429 as a usage limit only when it says when it resets', () => {
    expect(classifyRun(log('API Error: 429 rate_limit_error · resets 5pm (UTC)'), NOW).kind).toBe(
      'usage_limit',
    );
    expect(classifyRun(log('API Error: 429 {"type":"rate_limit_error"}'), NOW).kind).toBe(
      'overloaded',
    );
  });

  it('recognises an overloaded API', () => {
    expect(classifyRun(log('API Error: 529 {"type":"overloaded_error"}'), NOW).kind).toBe(
      'overloaded',
    );
  });

  it('tells a model the plan does not offer apart from a limit', () => {
    expect(classifyRun(log('The model opus is not available on your plan'), NOW).kind).toBe(
      'model_unavailable',
    );
  });

  it('reports running out of turns', () => {
    const entries = [{ type: 'result', subtype: 'error_max_turns', is_error: true, result: '' }];
    expect(classifyRun(entries, NOW).kind).toBe('max_turns');
  });

  it('calls anything else an error, with its message', () => {
    const verdict = classifyRun(log('TypeError: cannot read properties of undefined'), NOW);
    expect(verdict.kind).toBe('error');
    expect(verdict.message).toContain('TypeError');
  });

  it('ignores a limit that was hit early and retried, if the run then succeeded', () => {
    const entries = [
      { type: 'assistant', message: { content: [{ type: 'text', text: 'API Error: 429' }] } },
      { type: 'result', subtype: 'success', is_error: false, result: 'all done' },
    ];
    expect(classifyRun(entries, NOW).kind).toBe('ok');
  });
});

describe('parseReset', () => {
  it('reads an epoch after a bar', () => {
    expect(parseReset('limit reached|1760868000', NOW)?.toISOString()).toBe(
      '2025-10-19T10:00:00.000Z',
    );
  });

  it('reads a time in India and returns the next one after now', () => {
    expect(parseReset('resets 3pm (Asia/Kolkata)', NOW)?.toISOString()).toBe(
      '2026-10-19T09:30:00.000Z',
    );
    // 2pm India time has already passed today, so it is tomorrow's.
    expect(parseReset('resets 2pm (Asia/Kolkata)', NOW)?.toISOString()).toBe(
      '2026-10-20T08:30:00.000Z',
    );
  });

  it('assumes UTC when no zone is given or the zone is unknown', () => {
    expect(parseReset('resets at 15:00', NOW)?.toISOString()).toBe('2026-10-19T15:00:00.000Z');
    expect(parseReset('resets 11am (Mars/Base)', NOW)?.toISOString()).toBe(
      '2026-10-19T11:00:00.000Z',
    );
  });

  it('reads 12am and 12pm the way clocks do', () => {
    expect(parseReset('resets 12am (UTC)', NOW)?.toISOString()).toBe('2026-10-20T00:00:00.000Z');
    expect(parseReset('resets 12pm (UTC)', NOW)?.toISOString()).toBe('2026-10-19T12:00:00.000Z');
  });

  it('honours a weekday', () => {
    // NOW is a Monday at 09:00 UTC, so "Mon 9am" is a week away and "Wed 9am" two days away.
    expect(parseReset('resets Mon 9am (UTC)', NOW)?.toISOString()).toBe('2026-10-26T09:00:00.000Z');
    expect(parseReset('resets Wed 9am (UTC)', NOW)?.toISOString()).toBe('2026-10-21T09:00:00.000Z');
  });

  it('works across a daylight-saving change', () => {
    // London leaves summer time on 25 October 2026; 9am that Monday is 09:00 UTC.
    const sunday = new Date('2026-10-25T12:00:00Z');
    expect(parseReset('resets 9am (Europe/London)', sunday)?.toISOString()).toBe(
      '2026-10-26T09:00:00.000Z',
    );
  });

  it('returns null when there is no time', () => {
    expect(parseReset('usage limit reached', NOW)).toBeNull();
    expect(parseReset('resets 25:00', NOW)).toBeNull();
  });
});

describe('nextResume and overloadedRetry', () => {
  it('waits until just after a known reset', () => {
    const reset = new Date('2026-10-19T09:30:00Z');
    expect(nextResume(NOW, reset, 0).toISOString()).toBe('2026-10-19T09:32:00.000Z');
  });

  it('backs off 30 minutes, 1 hour, 2 hours, then 5 hours without one', () => {
    const minutes = [0, 1, 2, 3, 9].map(
      (attempt) => (nextResume(NOW, null, attempt).getTime() - NOW.getTime()) / 60000,
    );
    expect(minutes).toEqual([30, 60, 120, 300, 300]);
  });

  it('ignores a reset time that has already passed', () => {
    const past = new Date('2026-10-19T08:00:00Z');
    expect((nextResume(NOW, past, 1).getTime() - NOW.getTime()) / 60000).toBe(60);
  });

  it('retries an overloaded card after 10, 20, then 30 minutes', () => {
    const minutes = [0, 1, 2, 5].map(
      (attempt) => (overloadedRetry(NOW, attempt).getTime() - NOW.getTime()) / 60000,
    );
    expect(minutes).toEqual([10, 20, 30, 30]);
  });
});
