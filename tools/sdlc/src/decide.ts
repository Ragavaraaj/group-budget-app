/**
 * The pipeline's decisions, kept pure so every rule has a test: what the poller does with each
 * card on the board, and whether a pull request may be merged.
 */
import type { FixReason, PendingWork, StageKey, StatusKey } from './model.ts';
import { CAPS, STALE_AFTER_MS } from './model.ts';
import type { CardState } from './state.ts';

export interface PrSnapshot {
  number: number;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  isDraft: boolean;
  headSha: string;
}

export interface CardSnapshot {
  itemId: string;
  kind: 'draft' | 'issue' | 'other';
  title: string;
  status: StatusKey | null;
  stage: StageKey | null;
  issue: { number: number; open: boolean; hasPlan: boolean } | null;
  state: CardState | null;
  pr: PrSnapshot | null;
}

export interface PollContext {
  now: Date;
  /** The global pause from the control issue, if any. */
  pausedUntil: Date | null;
  /** Claude jobs running right now, and how many may run at once. */
  running: number;
  maxParallel: number;
}

export type Action =
  | { kind: 'convert-draft'; itemId: string; title: string }
  | { kind: 'dispatch'; issue: number; work: PendingWork; why: string }
  | { kind: 'set'; issue: number; status?: StatusKey; stage?: StageKey; note?: string }
  | { kind: 'block'; issue: number; reason: string }
  | { kind: 'unblock'; issue: number; work: PendingWork | null; why: string }
  | { kind: 'merge-check'; issue: number; pr: number }
  | { kind: 'mark-paused'; issue: number; until: Date };

const STAGE_FOR_COLUMN: Partial<Record<StatusKey, (card: CardSnapshot) => PendingWork | null>> = {
  todo: () => ({ kind: 'plan' }),
  inProgress: (card) =>
    card.issue?.hasPlan ? { kind: 'implement' } : { kind: 'plan', autoImplement: true },
  inReview: (card) =>
    card.pr?.state === 'OPEN' ? { kind: 'fix', reason: 'review', pr: card.pr.number } : null,
};

function isStale(state: CardState | null, now: Date): boolean {
  if (!state?.updatedAt) return false;
  return now.getTime() - new Date(state.updatedAt).getTime() > STALE_AFTER_MS;
}

/** Stages during which a run should be reporting in; silence for 90 minutes means it died. */
const RUNNING_STAGES: StageKey[] = [
  'planning',
  'implementing',
  'fixing_ci',
  'addressing_review',
  'resolving_conflict',
  'ai_review',
];

/** What one card needs, before the parallel limit is applied. */
export function decideCard(card: CardSnapshot, ctx: PollContext): Action[] {
  if (card.kind === 'draft') {
    return card.status === null || card.status === 'todo' || card.status === 'inProgress'
      ? [{ kind: 'convert-draft', itemId: card.itemId, title: card.title }]
      : [];
  }
  if (card.kind !== 'issue' || !card.issue) return [];
  const issue = card.issue.number;
  const state = card.state;

  // A closed issue is finished, whatever the column says (the PR merged, or someone closed it).
  if (!card.issue.open) {
    return card.status === 'done' ? [] : [{ kind: 'set', issue, status: 'done' }];
  }
  if (card.pr?.state === 'MERGED') {
    return card.status === 'done' &&
      card.stage &&
      ['merged', 'deployed', 'deploy_failed'].includes(card.stage)
      ? []
      : [{ kind: 'set', issue, status: 'done', stage: 'merged' }];
  }

  if (card.status === 'blocked') return [];
  // Dragged out of Blocked: the person has answered, so pick the work up again.
  if (state?.blockedFrom) {
    if (card.status === null) return [];
    const sameColumn = card.status === state.blockedFrom.status;
    const work = sameColumn
      ? state.blockedFrom.work
      : (STAGE_FOR_COLUMN[card.status]?.(card) ?? null);
    return [
      { kind: 'unblock', issue, work, why: sameColumn ? 'moved back' : 'moved to a new column' },
    ];
  }

  const paused = ctx.pausedUntil !== null && ctx.pausedUntil.getTime() > ctx.now.getTime();
  if (state?.pending) {
    if (paused) {
      return card.stage === 'paused' || !ctx.pausedUntil
        ? []
        : [{ kind: 'mark-paused', issue, until: ctx.pausedUntil }];
    }
    if (state.retryAfter && new Date(state.retryAfter).getTime() > ctx.now.getTime()) return [];
    return [{ kind: 'dispatch', issue, work: state.pending, why: 'resuming queued work' }];
  }

  if (card.stage && RUNNING_STAGES.includes(card.stage) && isStale(state, ctx.now)) {
    return [
      {
        kind: 'block',
        issue,
        reason: `the ${card.stage.replaceAll('_', ' ')} run stopped reporting`,
      },
    ];
  }
  // Dispatched but never started (a lost dispatch, a cancelled run): send it again.
  if (card.stage === 'queued' && isStale(state, ctx.now) && card.status !== null) {
    const work = STAGE_FOR_COLUMN[card.status]?.(card);
    if (work) return [{ kind: 'dispatch', issue, work, why: 'the queued run never started' }];
  }

  switch (card.status) {
    case null:
    case 'todo':
      if (card.stage === null)
        return [{ kind: 'dispatch', issue, work: { kind: 'plan' }, why: 'new card' }];
      return [];
    case 'inProgress':
      // Dragged to In Progress: that is the approval. Without a plan, plan first and carry on.
      if (card.stage === null || card.stage === 'queued') {
        const work: PendingWork = card.issue.hasPlan
          ? { kind: 'implement' }
          : { kind: 'plan', autoImplement: true };
        return card.stage === 'queued'
          ? []
          : [{ kind: 'dispatch', issue, work, why: 'moved to In Progress' }];
      }
      if (card.stage === 'awaiting_approval' || card.stage === 'needs_input') {
        return [
          {
            kind: 'dispatch',
            issue,
            work: { kind: 'implement' },
            why: 'plan approved by moving the card',
          },
        ];
      }
      return [];
    case 'inReview': {
      const pr = card.pr;
      if (pr?.state !== 'OPEN') return [];
      if (pr.mergeable === 'CONFLICTING' && card.stage !== 'resolving_conflict') {
        return [
          {
            kind: 'dispatch',
            issue,
            work: { kind: 'fix', reason: 'conflict', pr: pr.number },
            why: 'merge conflict',
          },
        ];
      }
      // No event fires when the last review thread is resolved, so the poller checks the gate.
      if (card.stage === 'awaiting_your_approval' || card.stage === 'ci_running') {
        return [{ kind: 'merge-check', issue, pr: pr.number }];
      }
      return [];
    }
    default:
      return [];
  }
}

/** Every card's actions, with Claude dispatches limited to the free slots, oldest waiting first. */
export function decideAll(cards: CardSnapshot[], ctx: PollContext): Action[] {
  const actions = cards.flatMap((card) => decideCard(card, ctx));
  const dispatches = actions.filter(
    (a): a is Extract<Action, { kind: 'dispatch' }> => a.kind === 'dispatch',
  );
  const unblocks = actions.filter(
    (a): a is Extract<Action, { kind: 'unblock' }> => a.kind === 'unblock',
  );
  const others = actions.filter((a) => a.kind !== 'dispatch' && a.kind !== 'unblock');

  const paused = ctx.pausedUntil !== null && ctx.pausedUntil.getTime() > ctx.now.getTime();
  const since = (issue: number) => {
    const card = cards.find((c) => c.issue?.number === issue);
    return card?.state?.pendingSince ?? card?.state?.updatedAt ?? '';
  };
  dispatches.sort((a, b) => since(a.issue).localeCompare(since(b.issue)) || a.issue - b.issue);
  let free = paused ? 0 : Math.max(0, ctx.maxParallel - ctx.running);
  const allowed: Action[] = [];
  for (const dispatch of dispatches) {
    if (free > 0) {
      allowed.push(dispatch);
      free--;
    }
  }
  // An unblock always clears the Blocked state; its work then queues like any other.
  return [...others, ...unblocks, ...allowed];
}

export interface Review {
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
  author: string;
  isBot: boolean;
  canPush: boolean;
  commitSha: string | null;
}

export interface MergeFacts {
  number: number;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  isDraft: boolean;
  fromThisRepo: boolean;
  headSha: string;
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  linkedIssues: number[];
  boardIssue: number | null;
  ci: 'success' | 'failure' | 'pending' | 'missing';
  unresolvedThreads: number;
  /** The latest decisive review per person (GitHub's `latestOpinionatedReviews`). */
  reviews: Review[];
  aiReviewedSha: string | null;
}

export interface GateResult {
  ok: boolean;
  reasons: string[];
}

/** All of these must hold before the pipeline merges: CI, threads, approval, and the issue link. */
export function evaluateMergeGate(f: MergeFacts): GateResult {
  const reasons: string[] = [];
  if (f.state !== 'OPEN') reasons.push(`the pull request is ${f.state.toLowerCase()}`);
  if (f.isDraft) reasons.push('the pull request is a draft');
  if (!f.fromThisRepo) reasons.push('the pull request comes from a fork');
  if (f.boardIssue === null || !f.linkedIssues.includes(f.boardIssue)) {
    reasons.push('the pull request does not close its board issue (`Closes #n`)');
  }
  if (f.ci !== 'success') reasons.push(`CI on the head commit is ${f.ci}`);
  if (f.unresolvedThreads > 0) {
    reasons.push(
      `${f.unresolvedThreads} review thread${f.unresolvedThreads === 1 ? ' is' : 's are'} unresolved`,
    );
  }
  if (f.aiReviewedSha !== f.headSha)
    reasons.push('the AI review has not passed on the head commit');

  const people = f.reviews.filter((r) => !r.isBot && r.canPush);
  if (people.some((r) => r.state === 'CHANGES_REQUESTED')) reasons.push('changes are requested');
  if (!people.some((r) => r.state === 'APPROVED' && r.commitSha === f.headSha)) {
    reasons.push(
      people.some((r) => r.state === 'APPROVED')
        ? 'the approval is for an older commit; approve the latest one'
        : 'waiting for your approval',
    );
  }
  if (f.mergeable === 'CONFLICTING') reasons.push('the branch conflicts with main');
  if (f.mergeable === 'UNKNOWN') reasons.push('GitHub is still working out whether it can merge');
  return { ok: reasons.length === 0, reasons };
}

/** Whether another fix round is allowed, and why not. */
export function fixAllowed(state: CardState, reason: FixReason): { ok: boolean; why?: string } {
  if (reason === 'ci' && state.ciFixes >= CAPS.ciFixes) {
    return { ok: false, why: `CI still fails after ${CAPS.ciFixes} fixes in a row` };
  }
  if (reason === 'review' && state.reviewRounds >= CAPS.reviewRounds) {
    return { ok: false, why: `review findings remain after ${CAPS.reviewRounds} rounds` };
  }
  return { ok: true };
}
