/**
 * How a piece of work maps onto the board and onto a workflow run: which stage and column it shows
 * while running, and which workflow, with which inputs, runs it.
 */
import type { FixReason, PendingWork, StageKey, StatusKey, WorkKind } from './model.ts';
import { WORKFLOWS } from './model.ts';

const KINDS: WorkKind[] = ['plan', 'implement', 'review', 'fix'];
const REASONS: FixReason[] = ['ci', 'review', 'conflict'];

export function parseWork(json: string | undefined | null): PendingWork | null {
  if (!json) return null;
  try {
    const value = JSON.parse(json) as Partial<PendingWork>;
    if (!KINDS.includes(value.kind as WorkKind)) return null;
    const work: PendingWork = { kind: value.kind as WorkKind };
    if (REASONS.includes(value.reason as FixReason)) work.reason = value.reason as FixReason;
    if (typeof value.pr === 'number') work.pr = value.pr;
    if (typeof value.failedRunId === 'number') work.failedRunId = value.failedRunId;
    if (value.autoImplement === true) work.autoImplement = true;
    return work;
  } catch {
    return null;
  }
}

/** The AI stage a card shows while this work runs. */
export function runningStage(work: PendingWork): StageKey {
  switch (work.kind) {
    case 'plan':
      return 'planning';
    case 'implement':
      return 'implementing';
    case 'review':
      return 'ai_review';
    case 'fix':
      return work.reason === 'ci'
        ? 'fixing_ci'
        : work.reason === 'conflict'
          ? 'resolving_conflict'
          : 'addressing_review';
  }
}

/** The column a card sits in while this work runs. */
export function runningStatus(work: PendingWork): StatusKey {
  switch (work.kind) {
    case 'plan':
      return work.autoImplement ? 'inProgress' : 'todo';
    case 'implement':
      return 'inProgress';
    default:
      return 'inReview';
  }
}

/** The workflow file and the `workflow_dispatch` inputs that run this work for an issue. */
export function dispatchFor(
  work: PendingWork,
  issue: number,
): { workflow: string; inputs: Record<string, string> } {
  const workflow = WORKFLOWS[work.kind];
  switch (work.kind) {
    case 'plan':
      return {
        workflow,
        inputs: { issue: String(issue), auto_implement: work.autoImplement ? 'true' : 'false' },
      };
    case 'implement':
      return { workflow, inputs: { issue: String(issue) } };
    case 'review':
      return { workflow, inputs: { pr: String(work.pr ?? '') } };
    case 'fix':
      return {
        workflow,
        inputs: {
          pr: String(work.pr ?? ''),
          reason: work.reason ?? 'review',
          failed_run: work.failedRunId ? String(work.failedRunId) : '',
        },
      };
  }
}

/** Which earlier session a new run may carry on from. */
export function canResume(
  session: { kind: WorkKind; wip: boolean } | null,
  work: PendingWork,
): boolean {
  if (!session) return false;
  if (session.wip) return session.kind === work.kind;
  if (work.kind === 'implement') return session.kind === 'plan';
  if (work.kind === 'fix') return session.kind === 'implement' || session.kind === 'fix';
  return false;
}
