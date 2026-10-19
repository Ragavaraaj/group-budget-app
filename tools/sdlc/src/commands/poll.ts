/**
 * The poller, every ten minutes: reads the whole board, decides what each card needs
 * (`decide.ts`), and does it. It is what notices a dragged card, a pause that has ended, a stuck
 * run, and a pull request whose last review thread was just resolved.
 */
import {
  blockCard,
  isPaused,
  loadCard,
  loadControl,
  openProject,
  saveCard,
  unblockCard,
} from '../card.ts';
import { type Action, type CardSnapshot, decideAll } from '../decide.ts';
import type { Env } from '../env.ts';
import { summary } from '../env.ts';
import { FIELD_STAGE, LABELS, stageKeyOf, statusKeyOf } from '../model.ts';
import { hasPlan } from '../plan.ts';
import { convertDraft, listItems, type ProjectItem } from '../project.ts';
import {
  addLabels,
  dispatch,
  getPullRequest,
  isPipelineComment,
  repositoryId,
  runningClaudeJobs,
} from '../repo.ts';
import { formatIst, PROGRESS_MARKER, parseState } from '../state.ts';
import { dispatchFor } from '../work.ts';
import { mergeCheck } from './merge.ts';

async function snapshot(env: Env, item: ProjectItem): Promise<CardSnapshot | null> {
  const base = {
    itemId: item.id,
    status: statusKeyOf(item.status),
    stage: stageKeyOf(item.stage),
  };
  const content = item.content;
  if (content.type === 'DraftIssue') {
    return { ...base, kind: 'draft', title: content.title, issue: null, state: null, pr: null };
  }
  if (content.type !== 'Issue' || content.repo !== `${env.repo.owner}/${env.repo.name}`)
    return null;
  const comment = content.comments.find(
    (c) => isPipelineComment(c.author) && c.body.includes(PROGRESS_MARKER),
  );
  const state = parseState(comment?.body);
  let pr: CardSnapshot['pr'] = null;
  if (
    state?.pr &&
    (base.status === 'inReview' || base.status === 'done' || base.status === 'inProgress')
  ) {
    const details = await getPullRequest(env.gh, env.repo, state.pr).catch(() => null);
    if (details) {
      pr = {
        number: details.number,
        state: details.state,
        mergeable: details.mergeable,
        isDraft: details.isDraft,
        headSha: details.headRefOid,
      };
    }
  }
  return {
    ...base,
    kind: 'issue',
    title: content.title,
    issue: {
      number: content.number,
      open: content.state === 'OPEN',
      hasPlan: hasPlan(content.body),
    },
    state,
    pr,
  };
}

function describe(action: Action): string {
  switch (action.kind) {
    case 'convert-draft':
      return `turn the draft "${action.title}" into an issue`;
    case 'dispatch':
      return `#${action.issue}: start ${action.work.kind}${action.work.reason ? ` (${action.work.reason})` : ''}, ${action.why}`;
    case 'set':
      return `#${action.issue}: set ${[action.status, action.stage].filter(Boolean).join(' / ')}`;
    case 'block':
      return `#${action.issue}: block, ${action.reason}`;
    case 'unblock':
      return `#${action.issue}: unblock, ${action.why}`;
    case 'merge-check':
      return `#${action.issue}: check whether #${action.pr} can merge`;
    case 'mark-paused':
      return `#${action.issue}: show as paused until ${formatIst(action.until)}`;
  }
}

export async function poll(env: Env, flags: Record<string, string>): Promise<void> {
  const dryRun = flags['dry-run'] === 'true';
  if (!env.enabled) return summary('The pipeline is switched off (SDLC_ENABLED=false).');
  const project = await openProject(env);
  if (!project || !env.pat) {
    return summary(
      'No board: set the `SDLC_TOKEN` secret and the `PROJECT_NUMBER` variable, then run SDLC Doctor.',
    );
  }
  const now = env.now();
  const control = await loadControl(env);
  const items = await listItems(env.pat, project.id, FIELD_STAGE);
  const cards = (await Promise.all(items.map((item) => snapshot(env, item)))).filter(
    (c): c is CardSnapshot => c !== null,
  );
  const running = await runningClaudeJobs(env.gh, env.repo, 0);
  const pausedUntil =
    control?.manual === true
      ? new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
      : control?.pausedUntil
        ? new Date(control.pausedUntil)
        : null;
  const actions = decideAll(cards, { now, pausedUntil, running, maxParallel: env.maxParallel });

  summary(
    [
      `**Board:** ${cards.length} card(s) · ${running} Claude job(s) running · ${isPaused(control, now) ? `paused until ${pausedUntil ? formatIst(pausedUntil) : '?'}` : 'not paused'}`,
      '',
      ...(actions.length ? actions.map((a) => `- ${describe(a)}`) : ['Nothing to do.']),
    ].join('\n'),
  );
  if (dryRun) return;

  for (const action of actions) {
    try {
      await run(env, action);
    } catch (error) {
      console.error(`Failed to ${describe(action)}: ${(error as Error).message}`);
    }
  }
}

async function run(env: Env, action: Action): Promise<void> {
  switch (action.kind) {
    case 'convert-draft': {
      if (!env.pat) return;
      const issue = await convertDraft(
        env.pat,
        action.itemId,
        await repositoryId(env.gh, env.repo),
      );
      await addLabels(env.gh, env.repo, issue, [LABELS.sdlc.name]);
      // The next poll plans it; the conversion alone is a change the board shows at once.
      console.log(`Draft "${action.title}" is now #${issue}`);
      return;
    }
    case 'dispatch': {
      const card = await loadCard(env, action.issue);
      const next = dispatchFor(action.work, action.issue);
      await saveCard(env, card, { stage: 'queued', note: action.why });
      await dispatch(env.gh, env.repo, next.workflow, next.inputs);
      return;
    }
    case 'set': {
      const card = await loadCard(env, action.issue);
      await saveCard(env, card, { status: action.status, stage: action.stage, note: action.note });
      return;
    }
    case 'block': {
      const card = await loadCard(env, action.issue);
      await blockCard(env, card, action.reason, card.state.pending);
      return;
    }
    case 'unblock': {
      const card = await loadCard(env, action.issue);
      const { work } = await unblockCard(env, card, card.status ?? undefined);
      if (action.work ?? work) {
        const next = dispatchFor((action.work ?? work) as NonNullable<typeof work>, action.issue);
        await dispatch(env.gh, env.repo, next.workflow, next.inputs);
      }
      return;
    }
    case 'merge-check':
      await mergeCheck(env, action.pr, { merge: true });
      return;
    case 'mark-paused': {
      const card = await loadCard(env, action.issue);
      await saveCard(env, card, {
        stage: 'paused',
        note: `usage limit; resumes ~${formatIst(action.until)}`,
      });
      return;
    }
  }
}
