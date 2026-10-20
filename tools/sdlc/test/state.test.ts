import { describe, expect, it } from 'vitest';
import {
  emptyState,
  formatIst,
  PROGRESS_MARKER,
  parseState,
  renderProgress,
  withStage,
} from '../src/state.ts';

const NOW = new Date('2026-10-19T09:35:00Z');

describe('the progress comment', () => {
  it('round-trips the state through the rendered comment', () => {
    const state = {
      ...withStage(emptyState(), 'implementing', NOW, {
        note: 'implement',
        run: 'https://example.test/run/1',
      }),
      pending: { kind: 'fix' as const, reason: 'ci' as const, pr: 40, failedRunId: 77 },
      pendingSince: NOW.toISOString(),
      blockedFrom: { status: 'inReview' as const, stage: 'fixing_ci' as const, work: null },
      ciFixes: 2,
      session: {
        id: 's',
        runId: 5,
        artifact: 'sdlc-wip-12',
        kind: 'implement' as const,
        wip: true,
      },
      milestones: { planned: NOW.toISOString() },
    };
    const body = renderProgress(state, NOW);
    expect(body.startsWith(PROGRESS_MARKER)).toBe(true);
    expect(parseState(body)).toEqual(state);
  });

  it('survives text a person adds around it, and characters that would end an HTML comment', () => {
    const state = withStage(emptyState(), 'blocked', NOW, {
      note: 'a note with --> and <!-- in it',
    });
    const body = `Someone wrote above.\n\n${renderProgress(state, NOW)}\n\nAnd below.`;
    expect(parseState(body)?.history[0]?.note).toBe('a note with --> and <!-- in it');
  });

  it('fills in fields that older comments do not have', () => {
    const old = { ...emptyState() } as Record<string, unknown>;
    delete old.simulated;
    delete old.session;
    const body = `<!-- sdlc:state ${Buffer.from(JSON.stringify(old)).toString('base64')} -->`;
    expect(parseState(body)).toMatchObject({ simulated: [], session: null });
  });

  it('returns null for missing, garbled or foreign state', () => {
    expect(parseState(undefined)).toBeNull();
    expect(parseState('no state here')).toBeNull();
    expect(parseState('<!-- sdlc:state bm90IGpzb24= -->')).toBeNull();
    const v2 = Buffer.from(JSON.stringify({ v: 2 })).toString('base64');
    expect(parseState(`<!-- sdlc:state ${v2} -->`)).toBeNull();
  });

  it('shows the checklist, the current stage and the rounds', () => {
    const state = {
      ...withStage(emptyState(), 'fixing_ci', NOW, { run: 'https://example.test/run/2' }),
      ciFixes: 1,
      pr: 40,
      milestones: { planned: NOW.toISOString(), approved: NOW.toISOString() },
    };
    const body = renderProgress(state, NOW);
    expect(body).toContain('- [x] Plan written · Mon 19 Oct, 15:05 IST');
    expect(body).toContain('- [ ] Merged');
    expect(body).toContain('**Now:** Fixing CI ([run](https://example.test/run/2))');
    expect(body).toContain('CI fixes 1/3');
    expect(body).toContain('**Pull request:** #40');
  });

  it('keeps only the most recent history', () => {
    let state = emptyState();
    for (let i = 0; i < 40; i++) state = withStage(state, i % 2 ? 'planning' : 'queued', NOW);
    expect(state.history).toHaveLength(25);
  });
});

describe('formatIst', () => {
  it('shows India time', () => {
    expect(formatIst(new Date('2026-10-19T18:45:00Z'))).toBe('Tue 20 Oct, 00:15 IST');
  });
});
