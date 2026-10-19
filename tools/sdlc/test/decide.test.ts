import { describe, expect, it } from 'vitest';
import {
  type CardSnapshot,
  decideAll,
  decideCard,
  evaluateMergeGate,
  fixAllowed,
  type MergeFacts,
  type PollContext,
} from '../src/decide.ts';
import { type CardState, emptyState } from '../src/state.ts';

const NOW = new Date('2026-10-19T09:00:00Z');
const ctx: PollContext = { now: NOW, pausedUntil: null, running: 0, maxParallel: 1 };
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60000).toISOString();

function card(
  overrides: Partial<CardSnapshot> = {},
  state: Partial<CardState> | null = null,
): CardSnapshot {
  return {
    itemId: 'item-1',
    kind: 'issue',
    title: 'Show the app version',
    status: 'todo',
    stage: null,
    issue: { number: 12, open: true, hasPlan: false },
    state: state ? { ...emptyState(), updatedAt: minutesAgo(5), ...state } : null,
    pr: null,
    ...overrides,
  };
}

const openPr = {
  number: 40,
  state: 'OPEN' as const,
  mergeable: 'MERGEABLE' as const,
  isDraft: false,
  headSha: 'abc',
};

describe('decideCard: Todo', () => {
  it('converts a draft card into an issue', () => {
    const draft = card({ kind: 'draft', issue: null });
    expect(decideCard(draft, ctx)).toEqual([
      { kind: 'convert-draft', itemId: 'item-1', title: 'Show the app version' },
    ]);
  });

  it('leaves drafts in other columns alone', () => {
    expect(decideCard(card({ kind: 'draft', issue: null, status: 'done' }), ctx)).toEqual([]);
  });

  it('plans a new card', () => {
    expect(decideCard(card(), ctx)).toMatchObject([{ kind: 'dispatch', work: { kind: 'plan' } }]);
  });

  it('plans a card with no column yet', () => {
    expect(decideCard(card({ status: null }), ctx)).toMatchObject([
      { kind: 'dispatch', work: { kind: 'plan' } },
    ]);
  });

  it('waits while a plan awaits approval', () => {
    expect(decideCard(card({ stage: 'awaiting_approval' }, {}), ctx)).toEqual([]);
  });

  it('ignores cards from other repositories and pull request cards', () => {
    expect(decideCard(card({ kind: 'other', issue: null }), ctx)).toEqual([]);
  });
});

describe('decideCard: In Progress', () => {
  it('treats dragging a planned card to In Progress as approval', () => {
    const planned = card(
      {
        status: 'inProgress',
        stage: 'awaiting_approval',
        issue: { number: 12, open: true, hasPlan: true },
      },
      {},
    );
    expect(decideCard(planned, ctx)).toMatchObject([
      { kind: 'dispatch', work: { kind: 'implement' } },
    ]);
  });

  it('plans first, then carries on, when an unplanned card is put straight into In Progress', () => {
    expect(decideCard(card({ status: 'inProgress' }), ctx)).toMatchObject([
      { kind: 'dispatch', work: { kind: 'plan', autoImplement: true } },
    ]);
  });

  it('implements a planned card dropped into In Progress with no stage', () => {
    const planned = card({
      status: 'inProgress',
      issue: { number: 12, open: true, hasPlan: true },
    });
    expect(decideCard(planned, ctx)).toMatchObject([
      { kind: 'dispatch', work: { kind: 'implement' } },
    ]);
  });

  it('blocks an implementation that stopped reporting 90 minutes ago', () => {
    const stuck = card(
      { status: 'inProgress', stage: 'implementing' },
      { updatedAt: minutesAgo(91) },
    );
    expect(decideCard(stuck, ctx)).toMatchObject([
      { kind: 'block', reason: 'the implementing run stopped reporting' },
    ]);
  });

  it('leaves a running implementation alone while it reports in', () => {
    expect(
      decideCard(
        card({ status: 'inProgress', stage: 'implementing' }, { updatedAt: minutesAgo(30) }),
        ctx,
      ),
    ).toEqual([]);
  });

  it('sends a dispatch again when the queued run never started', () => {
    const lost = card(
      { status: 'inProgress', stage: 'queued', issue: { number: 12, open: true, hasPlan: true } },
      { updatedAt: minutesAgo(95) },
    );
    expect(decideCard(lost, ctx)).toMatchObject([
      { kind: 'dispatch', work: { kind: 'implement' } },
    ]);
  });
});

describe('decideCard: In Review and Done', () => {
  it('resolves a merge conflict', () => {
    const conflicted = card(
      {
        status: 'inReview',
        stage: 'awaiting_your_approval',
        pr: { ...openPr, mergeable: 'CONFLICTING' },
      },
      { pr: 40 },
    );
    expect(decideCard(conflicted, ctx)).toMatchObject([
      { kind: 'dispatch', work: { kind: 'fix', reason: 'conflict', pr: 40 } },
    ]);
  });

  it('does not start a second conflict fix while one runs', () => {
    const fixing = card(
      {
        status: 'inReview',
        stage: 'resolving_conflict',
        pr: { ...openPr, mergeable: 'CONFLICTING' },
      },
      { pr: 40 },
    );
    expect(decideCard(fixing, ctx)).toEqual([]);
  });

  it('checks the merge gate while waiting for approval (thread resolutions fire no event)', () => {
    const waiting = card(
      { status: 'inReview', stage: 'awaiting_your_approval', pr: openPr },
      { pr: 40 },
    );
    expect(decideCard(waiting, ctx)).toEqual([{ kind: 'merge-check', issue: 12, pr: 40 }]);
  });

  it('moves a card whose pull request merged to Done', () => {
    const merged = card(
      { status: 'inReview', stage: 'merging', pr: { ...openPr, state: 'MERGED' } },
      { pr: 40 },
    );
    expect(decideCard(merged, ctx)).toEqual([
      { kind: 'set', issue: 12, status: 'done', stage: 'merged' },
    ]);
  });

  it('leaves a merged and deployed card alone', () => {
    const done = card(
      { status: 'done', stage: 'deployed', pr: { ...openPr, state: 'MERGED' } },
      { pr: 40 },
    );
    expect(decideCard(done, ctx)).toEqual([]);
  });

  it('moves a closed issue to Done', () => {
    expect(decideCard(card({ issue: { number: 12, open: false, hasPlan: true } }), ctx)).toEqual([
      { kind: 'set', issue: 12, status: 'done' },
    ]);
  });
});

describe('decideCard: Blocked', () => {
  const blockedFrom = {
    status: 'inReview' as const,
    stage: 'fixing_ci' as const,
    work: { kind: 'fix' as const, reason: 'ci' as const, pr: 40 },
  };

  it('waits while the card sits in Blocked', () => {
    expect(decideCard(card({ status: 'blocked', stage: 'blocked' }, { blockedFrom }), ctx)).toEqual(
      [],
    );
  });

  it('picks the remembered work up again when the card is dragged back', () => {
    expect(
      decideCard(card({ status: 'inReview', stage: 'blocked' }, { blockedFrom }), ctx),
    ).toEqual([{ kind: 'unblock', issue: 12, work: blockedFrom.work, why: 'moved back' }]);
  });

  it("starts the new column's stage when dragged somewhere else", () => {
    expect(decideCard(card({ status: 'todo', stage: 'blocked' }, { blockedFrom }), ctx)).toEqual([
      { kind: 'unblock', issue: 12, work: { kind: 'plan' }, why: 'moved to a new column' },
    ]);
  });
});

describe('decideCard: pauses and queued work', () => {
  const pending = { kind: 'implement' as const };

  it('resumes queued work once nothing holds it back', () => {
    expect(
      decideCard(
        card({ status: 'inProgress', stage: 'queued' }, { pending, pendingSince: minutesAgo(3) }),
        ctx,
      ),
    ).toMatchObject([{ kind: 'dispatch', work: pending, why: 'resuming queued work' }]);
  });

  it('shows the card as paused while the global pause lasts, and does nothing more', () => {
    const until = new Date(NOW.getTime() + 3600000);
    const paused = { ...ctx, pausedUntil: until };
    expect(
      decideCard(card({ status: 'inProgress', stage: 'queued' }, { pending }), paused),
    ).toEqual([{ kind: 'mark-paused', issue: 12, until }]);
    expect(
      decideCard(card({ status: 'inProgress', stage: 'paused' }, { pending }), paused),
    ).toEqual([]);
  });

  it("respects a card's own retry time", () => {
    const later = new Date(NOW.getTime() + 600000).toISOString();
    expect(
      decideCard(
        card({ status: 'inProgress', stage: 'queued' }, { pending, retryAfter: later }),
        ctx,
      ),
    ).toEqual([]);
  });

  it('resumes after the pause has passed', () => {
    const over = { ...ctx, pausedUntil: new Date(NOW.getTime() - 60000) };
    expect(
      decideCard(card({ status: 'inProgress', stage: 'paused' }, { pending }), over),
    ).toMatchObject([{ kind: 'dispatch', work: pending }]);
  });
});

describe('decideAll', () => {
  const waiting = (issue: number, since: string) =>
    card(
      {
        itemId: `item-${issue}`,
        status: 'inProgress',
        stage: 'queued',
        issue: { number: issue, open: true, hasPlan: true },
      },
      { pending: { kind: 'implement' }, pendingSince: since },
    );

  it('starts only as many Claude jobs as there are free slots, oldest waiting first', () => {
    const cards = [
      waiting(3, minutesAgo(5)),
      waiting(2, minutesAgo(50)),
      waiting(4, minutesAgo(20)),
    ];
    const actions = decideAll(cards, { ...ctx, maxParallel: 2 });
    expect(actions.map((a) => ('issue' in a ? a.issue : 0))).toEqual([2, 4]);
  });

  it('starts nothing while all slots are taken or the pipeline is paused', () => {
    const cards = [waiting(2, minutesAgo(5))];
    expect(decideAll(cards, { ...ctx, running: 1 })).toEqual([]);
    expect(
      decideAll(cards, { ...ctx, pausedUntil: new Date(NOW.getTime() + 60000) }),
    ).toMatchObject([{ kind: 'mark-paused' }]);
  });

  it('never holds back board bookkeeping because of the slots', () => {
    const done = card({ issue: { number: 9, open: false, hasPlan: true } });
    expect(decideAll([done], { ...ctx, running: 5 })).toEqual([
      { kind: 'set', issue: 9, status: 'done' },
    ]);
  });
});

describe('evaluateMergeGate', () => {
  const ready: MergeFacts = {
    number: 40,
    state: 'OPEN',
    isDraft: false,
    fromThisRepo: true,
    headSha: 'abc',
    mergeable: 'MERGEABLE',
    linkedIssues: [12],
    boardIssue: 12,
    ci: 'success',
    unresolvedThreads: 0,
    reviews: [
      { state: 'APPROVED', author: 'owner', isBot: false, canPush: true, commitSha: 'abc' },
    ],
    aiReviewedSha: 'abc',
  };

  it('opens when everything holds', () => {
    expect(evaluateMergeGate(ready)).toEqual({ ok: true, reasons: [] });
  });

  it.each<[string, Partial<MergeFacts>, RegExp]>([
    ['closed', { state: 'CLOSED' }, /closed/],
    ['draft', { isDraft: true }, /draft/],
    ['fork', { fromThisRepo: false }, /fork/],
    ['no issue link', { linkedIssues: [] }, /Closes #n/],
    ['CI failing', { ci: 'failure' }, /CI on the head commit is failure/],
    ['CI pending', { ci: 'pending' }, /pending/],
    ['open threads', { unresolvedThreads: 2 }, /2 review threads are unresolved/],
    ['one open thread', { unresolvedThreads: 1 }, /1 review thread is unresolved/],
    ['no AI review on the head', { aiReviewedSha: 'old' }, /AI review/],
    ['conflict', { mergeable: 'CONFLICTING' }, /conflicts/],
    ['mergeability unknown', { mergeable: 'UNKNOWN' }, /working out/],
  ])('stays shut when %s', (_name, change, reason) => {
    const result = evaluateMergeGate({ ...ready, ...change });
    expect(result.ok).toBe(false);
    expect(result.reasons.join('\n')).toMatch(reason);
  });

  it('wants an approval on the current head commit', () => {
    const stale = {
      ...ready,
      reviews: [{ ...ready.reviews[0], commitSha: 'older' } as MergeFacts['reviews'][0]],
    };
    expect(evaluateMergeGate(stale).reasons).toEqual([
      'the approval is for an older commit; approve the latest one',
    ]);
    expect(evaluateMergeGate({ ...ready, reviews: [] }).reasons).toEqual([
      'waiting for your approval',
    ]);
  });

  it('does not count approvals from bots or from people who cannot push', () => {
    const bot = {
      state: 'APPROVED' as const,
      author: 'claude[bot]',
      isBot: true,
      canPush: true,
      commitSha: 'abc',
    };
    const reader = {
      state: 'APPROVED' as const,
      author: 'someone',
      isBot: false,
      canPush: false,
      commitSha: 'abc',
    };
    expect(evaluateMergeGate({ ...ready, reviews: [bot, reader] }).ok).toBe(false);
  });

  it('stays shut while anyone with push access requests changes', () => {
    const changes = {
      state: 'CHANGES_REQUESTED' as const,
      author: 'other',
      isBot: false,
      canPush: true,
      commitSha: 'abc',
    };
    const result = evaluateMergeGate({ ...ready, reviews: [...ready.reviews, changes] });
    expect(result.reasons).toEqual(['changes are requested']);
  });
});

describe('fixAllowed', () => {
  it('allows three CI fixes and three review rounds, then stops', () => {
    expect(fixAllowed({ ...emptyState(), ciFixes: 2 }, 'ci').ok).toBe(true);
    expect(fixAllowed({ ...emptyState(), ciFixes: 3 }, 'ci')).toMatchObject({ ok: false });
    expect(fixAllowed({ ...emptyState(), reviewRounds: 3 }, 'review')).toMatchObject({ ok: false });
    expect(fixAllowed({ ...emptyState(), ciFixes: 9, reviewRounds: 9 }, 'conflict').ok).toBe(true);
  });
});
