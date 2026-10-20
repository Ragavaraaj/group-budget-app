/**
 * Reactions to GitHub events that need no Claude: a bug issue joining the board, an issue closing,
 * a pull request merging by hand, and the owner's `/resume`, `/resume-now` and `/pause` comments.
 */
import { loadCard, loadControl, openProject, saveCard, saveControl, unblockCard } from '../card.ts';
import { type Env, readEvent, summary } from '../env.ts';
import { LABELS, type PendingWork, TRUSTED_ASSOCIATIONS } from '../model.ts';
import { hasPlan } from '../plan.ts';
import { addComment, dispatch, getPullRequest } from '../repo.ts';
import { dispatchFor } from '../work.ts';

interface IssueEvent {
  action: string;
  issue?: {
    number: number;
    state: string;
    labels: { name: string }[];
    user: { login: string } | null;
    author_association: string;
    pull_request?: unknown;
  };
  label?: { name: string };
  pull_request?: { number: number; merged: boolean };
  comment?: {
    body: string;
    author_association: string;
    user: { login: string; type: string } | null;
  };
}

const trusted = (association: string | undefined) =>
  (TRUSTED_ASSOCIATIONS as readonly string[]).includes(association ?? '');

export async function boardEvent(env: Env): Promise<void> {
  if (!env.enabled) return;
  const event = readEvent<IssueEvent>();
  const project = await openProject(env);

  if (event.issue && !event.issue.pull_request) {
    const issue = event.issue;
    const labels = issue.labels.map((l) => l.name);
    if ((event.action === 'opened' || event.action === 'labeled') && issue.state === 'open') {
      const wanted = labels.includes(LABELS.bug.name) || labels.includes(LABELS.sdlc.name);
      const fromClaude = issue.user?.login === 'claude[bot]' || issue.user?.login === 'claude';
      if (!wanted || !(trusted(issue.author_association) || fromClaude)) return;
      if (!project) return summary('No board connected; the issue was not added.');
      const card = await loadCard(env, issue.number, { addToBoard: true });
      if (!card.status) await saveCard(env, card, { status: 'todo', note: 'added to the board' });
      return;
    }
    if (event.action === 'closed') {
      const card = await loadCard(env, issue.number);
      if (card.itemId && card.status !== 'done') await saveCard(env, card, { status: 'done' });
      return;
    }
    return;
  }

  if (event.pull_request && event.action === 'closed' && event.pull_request.merged) {
    const pr = await getPullRequest(env.gh, env.repo, event.pull_request.number);
    for (const number of pr.linkedIssues) {
      const card = await loadCard(env, number);
      if (!card.itemId || card.status === 'done') continue;
      await saveCard(env, card, {
        state: {
          ...card.state,
          milestones: { ...card.state.milestones, merged: new Date().toISOString() },
        },
        status: 'done',
        stage: 'merged',
        note: `#${pr.number} merged`,
      });
    }
  }
}

export async function commentCommand(env: Env): Promise<void> {
  const event = readEvent<IssueEvent>();
  const comment = event.comment;
  const issue = event.issue;
  if (!comment || !issue || !trusted(comment.author_association) || comment.user?.type === 'Bot')
    return;
  const command = comment.body.trim().split(/\s+/)[0]?.toLowerCase();
  const control = await loadControl(env);

  if (control && issue.number === control.number) {
    if (command === '/resume-now') {
      await saveControl(env, {
        ...control,
        pausedUntil: null,
        manual: false,
        reason: null,
        since: null,
        limitHits: 0,
      });
      summary('Pause cleared; the next poll starts the queued work.');
      await dispatch(env.gh, env.repo, 'sdlc-board.yml', {}).catch(() => undefined);
    } else if (command === '/pause') {
      await saveControl(env, {
        ...control,
        manual: true,
        reason: 'paused by hand',
        since: new Date().toISOString(),
      });
      summary('The pipeline is paused until /resume-now.');
    }
    return;
  }

  if (issue.pull_request) return;
  if (command === '/approve' || command === '/replan') {
    const card = await loadCard(env, issue.number);
    if (card.state.blockedFrom || card.status === 'blocked') {
      await addComment(
        env.gh,
        env.repo,
        issue.number,
        'This card is blocked; comment `/resume` first.',
      );
      return;
    }
    if (command === '/approve' && !hasPlan(card.issue.body)) {
      await addComment(
        env.gh,
        env.repo,
        issue.number,
        'There is no plan to approve yet; the planner writes one first.',
      );
      return;
    }
    const work: PendingWork = command === '/approve' ? { kind: 'implement' } : { kind: 'plan' };
    const next = dispatchFor(work, issue.number);
    await saveCard(env, card, {
      ...(command === '/approve' ? { status: 'inProgress' as const } : {}),
      stage: 'queued',
      note: command === '/approve' ? 'plan approved' : 'replanning with your comments',
    });
    await dispatch(env.gh, env.repo, next.workflow, next.inputs);
    summary(`#${issue.number}: ${command.slice(1)} started.`);
    return;
  }

  if (command !== '/resume') return;
  const card = await loadCard(env, issue.number);
  if (card.state.blockedFrom || card.status === 'blocked') {
    const { work } = await unblockCard(env, card);
    if (work) {
      const next = dispatchFor(work, issue.number);
      await dispatch(env.gh, env.repo, next.workflow, next.inputs);
    }
    summary(`#${issue.number} unblocked${work ? `; ${work.kind} starts again` : ''}.`);
    return;
  }
  if (card.state.pending) {
    const next = dispatchFor(card.state.pending, issue.number);
    await saveCard(env, card, {
      state: { ...card.state, retryAfter: null },
      stage: 'queued',
      note: 'resumed by hand',
    });
    await dispatch(env.gh, env.repo, next.workflow, next.inputs);
    summary(`#${issue.number}: queued work started again.`);
  }
}
