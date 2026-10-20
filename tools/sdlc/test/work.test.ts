import { describe, expect, it } from 'vitest';
import {
  canResume,
  dispatchFor,
  parseWork,
  runningStage,
  runningStatus,
  workflowFileOffDefault,
} from '../src/work.ts';

describe('parseWork', () => {
  it('reads what the gate wrote and drops anything unexpected', () => {
    expect(parseWork('{"kind":"fix","reason":"ci","pr":40,"failedRunId":7,"extra":1}')).toEqual({
      kind: 'fix',
      reason: 'ci',
      pr: 40,
      failedRunId: 7,
    });
    expect(parseWork('{"kind":"deploy"}')).toBeNull();
    expect(parseWork('not json')).toBeNull();
    expect(parseWork('')).toBeNull();
  });
});

describe('stage, column and workflow for each kind of work', () => {
  it.each([
    [{ kind: 'plan' as const }, 'planning', 'todo'],
    [{ kind: 'plan' as const, autoImplement: true }, 'planning', 'inProgress'],
    [{ kind: 'implement' as const }, 'implementing', 'inProgress'],
    [{ kind: 'review' as const, pr: 4 }, 'ai_review', 'inReview'],
    [{ kind: 'fix' as const, reason: 'ci' as const, pr: 4 }, 'fixing_ci', 'inReview'],
    [{ kind: 'fix' as const, reason: 'review' as const, pr: 4 }, 'addressing_review', 'inReview'],
    [
      { kind: 'fix' as const, reason: 'conflict' as const, pr: 4 },
      'resolving_conflict',
      'inReview',
    ],
  ])('%j', (work, stage, status) => {
    expect(runningStage(work)).toBe(stage);
    expect(runningStatus(work)).toBe(status);
  });

  it('builds the dispatch inputs each workflow declares', () => {
    expect(dispatchFor({ kind: 'plan', autoImplement: true }, 12)).toEqual({
      workflow: 'sdlc-plan.yml',
      inputs: { issue: '12', auto_implement: 'true' },
    });
    expect(dispatchFor({ kind: 'implement' }, 12)).toEqual({
      workflow: 'sdlc-implement.yml',
      inputs: { issue: '12' },
    });
    expect(dispatchFor({ kind: 'review', pr: 40 }, 12)).toEqual({
      workflow: 'sdlc-review.yml',
      inputs: { pr: '40' },
    });
    expect(dispatchFor({ kind: 'fix', reason: 'ci', pr: 40, failedRunId: 9 }, 12)).toEqual({
      workflow: 'sdlc-fix.yml',
      inputs: { pr: '40', reason: 'ci', failed_run: '9' },
    });
  });
});

describe('canResume', () => {
  const session = (kind: 'plan' | 'implement' | 'fix', wip = false) => ({ kind, wip });

  it('carries the planning session into implementing, and implementing into fixes', () => {
    expect(canResume(session('plan'), { kind: 'implement' })).toBe(true);
    expect(canResume(session('implement'), { kind: 'fix', reason: 'ci' })).toBe(true);
    expect(canResume(session('fix'), { kind: 'fix', reason: 'review' })).toBe(true);
  });

  it('resumes paused work only in the same kind of run', () => {
    expect(canResume(session('implement', true), { kind: 'implement' })).toBe(true);
    expect(canResume(session('implement', true), { kind: 'fix' })).toBe(false);
  });

  it('starts fresh otherwise', () => {
    expect(canResume(null, { kind: 'implement' })).toBe(false);
    expect(canResume(session('plan'), { kind: 'plan' })).toBe(false);
    expect(canResume(session('implement'), { kind: 'review' })).toBe(false);
  });
});

describe('workflowFileOffDefault', () => {
  it('names the file when the run uses a pull request copy of its workflow', () => {
    expect(
      workflowFileOffDefault('acme/app/.github/workflows/sdlc-review.yml@refs/pull/24/merge'),
    ).toBe('.github/workflows/sdlc-review.yml');
    expect(
      workflowFileOffDefault('acme/app/.github/workflows/sdlc-fix.yml@refs/heads/feat/x'),
    ).toBe('.github/workflows/sdlc-fix.yml');
  });

  it('is null for the default branch, or when there is no ref', () => {
    expect(
      workflowFileOffDefault('acme/app/.github/workflows/sdlc-fix.yml@refs/heads/main'),
    ).toBeNull();
    expect(workflowFileOffDefault(undefined)).toBeNull();
    expect(workflowFileOffDefault('garbage')).toBeNull();
  });
});
