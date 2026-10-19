/**
 * A card's memory between runs. It lives in one comment on the issue (the "progress comment"),
 * written only by the pipeline: a checklist for people, and the state itself base64-encoded in an
 * HTML comment so a human edit to the visible part can't corrupt it.
 */
import type { PendingWork, StageKey, StatusKey, WorkKind } from './model.ts';
import { STAGES } from './model.ts';

export const PROGRESS_MARKER = '<!-- sdlc:progress -->';
const STATE_RE = /<!-- sdlc:state ([A-Za-z0-9+/=]+) -->/;

export const MILESTONES = [
  ['planned', 'Plan written'],
  ['approved', 'Plan approved'],
  ['prOpened', 'Pull request opened'],
  ['ciGreen', 'CI green on the latest commit'],
  ['aiReviewed', 'AI review passed'],
  ['ownerApproved', 'Approved by you'],
  ['merged', 'Merged'],
  ['deployed', 'Deployed'],
] as const;
export type Milestone = (typeof MILESTONES)[number][0];

export interface HistoryEntry {
  at: string;
  stage: StageKey;
  note?: string;
  run?: string;
}

export interface CardState {
  v: 1;
  stage: StageKey | null;
  /** When the stage last changed or a run last reported in; used to spot stuck cards. */
  updatedAt: string | null;
  pending: PendingWork | null;
  pendingSince: string | null;
  /** Per-card backoff (an overloaded API), on top of the global pause. */
  retryAfter: string | null;
  blockedFrom: { status: StatusKey; stage: StageKey | null; work: PendingWork | null } | null;
  blockedReason: string | null;
  ciFixes: number;
  reviewRounds: number;
  flakyReruns: number;
  limitHits: number;
  pr: number | null;
  branch: string | null;
  /** The commit the AI review last passed on; the merge gate wants it to be the head. */
  aiReviewedSha: string | null;
  /** The Claude session to resume, the run whose artifact holds it, and what made it. */
  session: { id: string; runId: number; artifact: string; kind: WorkKind; wip: boolean } | null;
  /** Stages a rehearsed usage limit (`SDLC_SIMULATE_LIMIT`) has already been shown for. */
  simulated: string[];
  milestones: Partial<Record<Milestone, string>>;
  history: HistoryEntry[];
}

export function emptyState(): CardState {
  return {
    v: 1,
    stage: null,
    updatedAt: null,
    pending: null,
    pendingSince: null,
    retryAfter: null,
    blockedFrom: null,
    blockedReason: null,
    ciFixes: 0,
    reviewRounds: 0,
    flakyReruns: 0,
    limitHits: 0,
    pr: null,
    branch: null,
    aiReviewedSha: null,
    session: null,
    simulated: [],
    milestones: {},
    history: [],
  };
}

const HISTORY_LIMIT = 25;

/** Records a stage change, keeping the last few entries for the history fold-out. */
export function withStage(
  state: CardState,
  stage: StageKey,
  now: Date,
  extra: { note?: string; run?: string } = {},
): CardState {
  const at = now.toISOString();
  const entry: HistoryEntry = { at, stage, ...extra };
  return {
    ...state,
    stage,
    updatedAt: at,
    history: [...state.history, entry].slice(-HISTORY_LIMIT),
  };
}

export function parseState(body: string | null | undefined): CardState | null {
  const match = body ? STATE_RE.exec(body) : null;
  if (!match?.[1]) return null;
  try {
    const parsed = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8')) as CardState;
    if (parsed?.v !== 1) return null;
    // Fields added later default to their empty value instead of breaking old comments.
    return { ...emptyState(), ...parsed };
  } catch {
    return null;
  }
}

/** Formats a time as people in India read it, e.g. "Tue 19 Oct, 15:05 IST". */
export function formatIst(date: Date): string {
  // Built from parts, because the punctuation Intl puts between them differs between ICU versions.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('weekday')} ${get('day')} ${get('month')}, ${get('hour')}:${get('minute')} IST`;
}

export function renderProgress(state: CardState, now: Date): string {
  const lines: string[] = [PROGRESS_MARKER, '### AI SDLC progress', ''];
  for (const [key, label] of MILESTONES) {
    const at = state.milestones[key];
    lines.push(`- [${at ? 'x' : ' '}] ${label}${at ? ` · ${formatIst(new Date(at))}` : ''}`);
  }
  lines.push('');

  const last = state.history.at(-1);
  if (state.stage) {
    const run = last?.run ? ` ([run](${last.run}))` : '';
    const note = last?.note ? `: ${last.note}` : '';
    lines.push(`**Now:** ${STAGES[state.stage]}${note}${run}`);
  }
  if (state.blockedReason) lines.push(`**Blocked because:** ${state.blockedReason}`);
  if (state.pr) lines.push(`**Pull request:** #${state.pr}`);
  lines.push(
    `**Rounds:** CI fixes ${state.ciFixes}/3 · review rounds ${state.reviewRounds}/3 · updated ${formatIst(now)}`,
  );
  lines.push('');
  lines.push(
    'Commands (comment on this issue): `/approve` start building the plan · `/replan` rewrite the plan with your comments · `/resume` continue after Blocked.',
  );

  if (state.history.length > 0) {
    lines.push('', '<details><summary>History</summary>', '');
    for (const entry of state.history) {
      const run = entry.run ? ` ([run](${entry.run}))` : '';
      const note = entry.note ? `: ${entry.note}` : '';
      lines.push(`- ${formatIst(new Date(entry.at))}, ${STAGES[entry.stage]}${note}${run}`);
    }
    lines.push('', '</details>');
  }

  const encoded = Buffer.from(JSON.stringify(state), 'utf8').toString('base64');
  lines.push('', `<!-- sdlc:state ${encoded} -->`);
  return lines.join('\n');
}
