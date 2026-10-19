/**
 * A card is an issue on the board plus its state. Saving one updates the three places people look:
 * the progress comment on the issue, the board's Status and AI stage, and the AI note.
 */
import type { Env } from './env.ts';
import type { PendingWork, StageKey, StatusKey } from './model.ts';
import { FIELD_NOTE, FIELD_STAGE, LABELS, STAGES, STATUS, statusKeyOf } from './model.ts';
import {
  boardItem,
  loadProject,
  type Project,
  setSelect,
  setShortDescription,
  setText,
} from './project.ts';
import {
  addComment,
  addLabels,
  editComment,
  getIssue,
  type Issue,
  isPipelineComment,
  listComments,
  type PullRequest,
  removeLabel,
  updateIssue,
} from './repo.ts';
import {
  type CardState,
  emptyState,
  formatIst,
  PROGRESS_MARKER,
  parseState,
  renderProgress,
  withStage,
} from './state.ts';

let projectCache: Promise<Project | null> | null = null;

/** The board, or null when the pipeline has no token or number for it (it then skips the board). */
export function openProject(env: Env): Promise<Project | null> {
  if (!projectCache) {
    projectCache =
      env.pat && env.projectNumber
        ? loadProject(env.pat, env.projectOwner, env.projectNumber).catch((error: Error) => {
            console.warn(`The board could not be loaded: ${error.message}`);
            return null;
          })
        : Promise.resolve(null);
  }
  return projectCache;
}

export interface Card {
  issue: Issue;
  state: CardState;
  commentId: number | null;
  itemId: string | null;
  status: StatusKey | null;
}

export async function loadCard(
  env: Env,
  number: number,
  options: { addToBoard?: boolean } = {},
): Promise<Card> {
  const [issue, comments, project] = await Promise.all([
    getIssue(env.gh, env.repo, number),
    listComments(env.gh, env.repo, number),
    openProject(env),
  ]);
  const comment = comments.find(
    (c) => isPipelineComment(c.user?.login) && c.body.includes(PROGRESS_MARKER),
  );
  const item =
    project && env.pat
      ? await boardItem(env.pat, project, env.repo.owner, env.repo.name, number, {
          add: options.addToBoard ?? false,
        })
      : null;
  return {
    issue,
    state: parseState(comment?.body) ?? emptyState(),
    commentId: comment?.id ?? null,
    itemId: item?.itemId ?? null,
    status: statusKeyOf(item?.status),
  };
}

export interface CardUpdate {
  state?: CardState;
  status?: StatusKey;
  stage?: StageKey;
  note?: string;
}

export async function saveCard(env: Env, card: Card, update: CardUpdate): Promise<Card> {
  const now = env.now();
  let state = update.state ?? card.state;
  if (update.stage) {
    state = withStage(state, update.stage, now, {
      note: update.note,
      run: env.runUrl ?? undefined,
    });
  }
  const body = renderProgress(state, now);
  let commentId = card.commentId;
  if (commentId) await editComment(env.gh, env.repo, commentId, body);
  else commentId = await addComment(env.gh, env.repo, card.issue.number, body);

  const project = await openProject(env);
  if (project && env.pat && card.itemId) {
    if (update.status)
      await setSelect(env.pat, project, card.itemId, 'Status', STATUS[update.status]);
    if (update.stage)
      await setSelect(env.pat, project, card.itemId, FIELD_STAGE, STAGES[update.stage]);
    if (update.stage || update.note) {
      const note = [update.note, env.runUrl].filter(Boolean).join(' · ');
      await setText(env.pat, project, card.itemId, FIELD_NOTE, note);
    }
  }
  return { ...card, state, commentId, status: update.status ?? card.status };
}

/** The board issue a pull request belongs to: the first issue it closes that is a pipeline card. */
export async function boardCardForPr(env: Env, pr: PullRequest): Promise<Card | null> {
  for (const issue of pr.linkedIssues) {
    const card = await loadCard(env, issue);
    if (card.itemId || card.issue.labels.some((l) => l.name === LABELS.sdlc.name)) return card;
  }
  return null;
}

/** Moves a card to Blocked, remembering where it was, and asks the owner for help. */
export async function blockCard(
  env: Env,
  card: Card,
  reason: string,
  work: PendingWork | null,
): Promise<Card> {
  const state: CardState = {
    ...card.state,
    blockedFrom: card.state.blockedFrom ?? {
      status: card.status ?? 'todo',
      stage: card.state.stage,
      work,
    },
    blockedReason: reason,
    pending: null,
    pendingSince: null,
  };
  await addLabels(env.gh, env.repo, card.issue.number, [LABELS.blocked.name]);
  await addComment(
    env.gh,
    env.repo,
    card.issue.number,
    [
      `@${env.owner} this card is **blocked**: ${reason}.`,
      '',
      'Answer here if something needs deciding, then comment `/resume` (or drag the card out of Blocked) and the pipeline carries on from where it stopped.',
      env.runUrl ? `\n[The run that stopped](${env.runUrl})` : '',
    ].join('\n'),
  );
  return saveCard(env, card, { state, status: 'blocked', stage: 'blocked', note: reason });
}

/** Clears Blocked and resets the round counters; returns the work to start again, if any. */
export async function unblockCard(
  env: Env,
  card: Card,
  status?: StatusKey,
): Promise<{ card: Card; work: PendingWork | null }> {
  const from = card.state.blockedFrom;
  const state: CardState = {
    ...card.state,
    blockedFrom: null,
    blockedReason: null,
    ciFixes: 0,
    reviewRounds: 0,
    flakyReruns: 0,
    retryAfter: null,
  };
  await removeLabel(env.gh, env.repo, card.issue.number, LABELS.blocked.name);
  const saved = await saveCard(env, card, {
    state,
    status: status ?? from?.status ?? 'todo',
    stage: from?.stage && from.stage !== 'blocked' ? from.stage : 'queued',
    note: 'resumed',
  });
  return { card: saved, work: from?.work ?? null };
}

/** Records work for later (a pause or a full house) without running it now. */
export function deferWork(state: CardState, work: PendingWork, now: Date): CardState {
  return { ...state, pending: work, pendingSince: state.pendingSince ?? now.toISOString() };
}

// ── The control issue: the global pause, visible on the board ──────────────────────────────────

export interface Control {
  number: number;
  pausedUntil: string | null;
  manual: boolean;
  reason: string | null;
  since: string | null;
  limitHits: number;
}

const CONTROL_RE = /<!-- sdlc:control ([A-Za-z0-9+/=]+) -->/;

export async function loadControl(env: Env): Promise<Control | null> {
  const issues = await env.gh.rest<
    { number: number; body: string | null; user: { login: string } | null }[]
  >(
    'GET',
    `/repos/${env.repo.owner}/${env.repo.name}/issues?labels=${encodeURIComponent(LABELS.control.name)}&state=open&per_page=10`,
  );
  const issue = issues.find((i) => isPipelineComment(i.user?.login));
  if (!issue) return null;
  const match = CONTROL_RE.exec(issue.body ?? '');
  let saved: Partial<Control> = {};
  if (match?.[1]) {
    try {
      saved = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8')) as Partial<Control>;
    } catch {
      saved = {};
    }
  }
  return {
    number: issue.number,
    pausedUntil: saved.pausedUntil ?? null,
    manual: saved.manual ?? false,
    reason: saved.reason ?? null,
    since: saved.since ?? null,
    limitHits: saved.limitHits ?? 0,
  };
}

export function isPaused(control: Control | null, now: Date): boolean {
  if (!control) return false;
  if (control.manual) return true;
  return control.pausedUntil !== null && new Date(control.pausedUntil).getTime() > now.getTime();
}

export function pauseLine(control: Control, now: Date): string {
  if (control.manual)
    return '⏸ AI paused by hand. Comment /resume-now on the control issue to restart.';
  if (control.pausedUntil && new Date(control.pausedUntil).getTime() > now.getTime()) {
    return `⏸ AI paused until ${formatIst(new Date(control.pausedUntil))} (${control.reason ?? 'usage limit'}). It resumes by itself.`;
  }
  return '▶ AI running.';
}

export function renderControl(control: Control, now: Date): string {
  const { number: _number, ...saved } = control;
  return [
    '### AI SDLC control',
    '',
    `**${pauseLine(control, now)}**`,
    '',
    'This issue holds the pipeline-wide pause. When Claude hits the plan’s usage limit the pipeline pauses here and resumes on its own after the reset; no work is lost. Comments from the owner:',
    '',
    '- `/resume-now`: clear the pause and start the queued work.',
    '- `/pause`: stop all AI work until `/resume-now`.',
    '',
    `<!-- sdlc:control ${Buffer.from(JSON.stringify(saved), 'utf8').toString('base64')} -->`,
  ].join('\n');
}

export async function saveControl(env: Env, control: Control): Promise<void> {
  const now = env.now();
  await updateIssue(env.gh, env.repo, control.number, { body: renderControl(control, now) });
  const project = await openProject(env);
  if (project && env.pat) {
    await setShortDescription(env.pat, project.id, pauseLine(control, now)).catch((error: Error) =>
      console.warn(`Could not update the board's description: ${error.message}`),
    );
  }
}
