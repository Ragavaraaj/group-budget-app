/**
 * The steps around each Claude run: the gate before it (may it run now?), reading how it ended,
 * pausing on a usage limit, and putting its results on the issue, the board and the pull request.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { branchName, changeTypeFor, isValidBranch } from '../branch.ts';
import {
  blockCard,
  boardCardForPr,
  type Card,
  deferWork,
  isPaused,
  loadCard,
  loadControl,
  saveCard,
  saveControl,
} from '../card.ts';
import { fixAllowed } from '../decide.ts';
import { type Env, intFlag, setOutput, summary } from '../env.ts';
import { classifyRun, nextResume, overloadedRetry } from '../limits.ts';
import { LABELS, type PendingWork, type WorkKind } from '../model.ts';
import { hasPlan, parsePlanOutput, planHeader, upsertPlan } from '../plan.ts';
import {
  addComment,
  addLabels,
  dispatch,
  getPullRequest,
  isPipelineComment,
  listThreads,
  openPullForBranch,
  type PullRequest,
  postReview,
  pullPatches,
  type ReviewThread,
  replyToReviewComment,
  requestReview,
  rerunFailedJobs,
  resolveThreads,
  runningClaudeJobs,
  updateIssue,
} from '../repo.ts';
import { buildReview, type Finding, REVIEW_MARKER, withFooter } from '../review.ts';
import { formatIst } from '../state.ts';
import { saveSession } from '../wip.ts';
import { canResume, dispatchFor, parseWork, runningStage, runningStatus } from '../work.ts';
import { mergeCheck } from './merge.ts';

type Flags = Record<string, string>;

function workFrom(flags: Flags): PendingWork {
  const fromJson = parseWork(flags.work ?? process.env.SDLC_WORK);
  if (fromJson) return fromJson;
  const work: PendingWork = { kind: flags.stage as WorkKind };
  if (flags.reason === 'ci' || flags.reason === 'review' || flags.reason === 'conflict')
    work.reason = flags.reason;
  const pr = intFlag(flags, 'pr');
  if (pr) work.pr = pr;
  const failed = intFlag(flags, 'failed-run');
  if (failed) work.failedRunId = failed;
  if (flags['auto-implement'] === 'true') work.autoImplement = true;
  return work;
}

function skip(why: string): void {
  setOutput('proceed', 'false');
  summary(`**Not running now:** ${why}`);
  console.log(`Not running: ${why}`);
}

export async function gate(env: Env, flags: Flags): Promise<void> {
  const now = env.now();
  const work = workFrom(flags);
  setOutput('proceed', 'false');
  if (!env.enabled) return skip('the pipeline is switched off (SDLC_ENABLED=false)');

  let pr: PullRequest | null = null;
  let card: Card | null = null;
  if (work.pr) {
    pr = await getPullRequest(env.gh, env.repo, work.pr);
    if (pr.state !== 'OPEN') return skip(`pull request #${pr.number} is ${pr.state.toLowerCase()}`);
    if (pr.headRepo !== `${env.repo.owner}/${env.repo.name}`)
      return skip('pull requests from forks are not handled');
    if (pr.isDraft && work.kind === 'review') return skip('the pull request is a draft');
    card = await boardCardForPr(env, pr);
    if (work.kind === 'fix' && !card) return skip('the pull request is not on the board');
  } else {
    const issue = intFlag(flags, 'issue');
    if (!issue) return skip('no issue or pull request given');
    card = await loadCard(env, issue);
  }

  if (card?.issue.state === 'closed') return skip(`issue #${card.issue.number} is closed`);
  if (card && (card.status === 'blocked' || card.state.blockedFrom)) {
    return skip(`issue #${card.issue.number} is blocked; comment /resume on it to continue`);
  }
  if (
    work.kind === 'fix' &&
    work.reason === 'ci' &&
    pr &&
    flags['failed-sha'] &&
    flags['failed-sha'] !== pr.headRefOid
  ) {
    return skip('a newer commit is already on the branch; its own CI run decides');
  }
  if (card && work.kind === 'implement' && !hasPlan(card.issue.body)) {
    await dispatch(env.gh, env.repo, 'sdlc-plan.yml', {
      issue: String(card.issue.number),
      auto_implement: 'true',
    });
    return skip('the issue has no plan yet, so planning runs first and implementation follows');
  }
  if (card && work.kind === 'fix' && work.reason) {
    const allowed = fixAllowed(card.state, work.reason);
    if (!allowed.ok) {
      await blockCard(env, card, allowed.why ?? 'too many rounds', work);
      return skip(allowed.why ?? 'too many rounds');
    }
  }

  const control = await loadControl(env);
  if (isPaused(control, now)) {
    if (card) {
      const until = control?.pausedUntil
        ? ` until ${formatIst(new Date(control.pausedUntil))}`
        : '';
      await saveCard(env, card, {
        state: deferWork(card.state, work, now),
        stage: 'paused',
        note: `waiting for the usage limit to reset${until}`,
      });
    }
    return skip(
      `the pipeline is paused${control?.pausedUntil ? ` until ${control.pausedUntil}` : ''}`,
    );
  }
  if (card?.state.retryAfter && new Date(card.state.retryAfter).getTime() > now.getTime()) {
    await saveCard(env, card, {
      state: deferWork(card.state, work, now),
      stage: 'queued',
      note: 'retrying later',
    });
    return skip(`this card retries after ${card.state.retryAfter}`);
  }
  // Only cards can wait their turn; a review of someone's own pull request just runs.
  if (card) {
    const running = await runningClaudeJobs(env.gh, env.repo, env.runId);
    if (running >= env.maxParallel) {
      await saveCard(env, card, {
        state: deferWork(card.state, work, now),
        stage: 'queued',
        note: `waiting for a free slot (${running} running, SDLC_MAX_PARALLEL=${env.maxParallel})`,
      });
      return skip(`${running} Claude job(s) already running`);
    }
  }

  setOutput('proceed', 'true');
  setOutput('work', JSON.stringify(work));
  setOutput('issue', card?.issue.number ?? '');
  setOutput('on_board', card ? 'true' : 'false');
  setOutput('title', card?.issue.title ?? pr?.title ?? '');
  if (pr) {
    setOutput('pr', pr.number);
    setOutput('head_ref', pr.headRefName);
    setOutput('head_sha', pr.headRefOid);
  }
  setOutput('review_depth', env.reviewDepth);

  if (!card) return;
  let state = { ...card.state, pending: null, pendingSince: null, retryAfter: null };
  if (work.kind === 'fix' && work.reason === 'ci') state = { ...state, ciFixes: state.ciFixes + 1 };
  if (work.kind === 'implement') {
    state = {
      ...state,
      milestones: { ...state.milestones, approved: state.milestones.approved ?? now.toISOString() },
    };
    const labels = card.issue.labels.map((l) => l.name);
    const branch =
      state.branch ?? branchName(changeTypeFor(null, labels), card.issue.number, card.issue.title);
    state = { ...state, branch };
    setOutput('branch', branch);
  }
  if (canResume(state.session, work) && state.session) {
    setOutput('resume_run', state.session.runId);
    setOutput('resume_artifact', state.session.artifact);
    setOutput('resume_session', state.session.id);
    setOutput('resume_wip', state.session.wip ? 'true' : 'false');
  }
  await saveCard(env, card, {
    state,
    status: runningStatus(work),
    stage: runningStage(work),
    note: work.reason ? `${work.kind} (${work.reason})` : work.kind,
  });
}

export async function classify(env: Env, flags: Flags): Promise<void> {
  const now = env.now();
  const file = flags.file;
  const log = file && existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as unknown) : null;
  let verdict = classifyRun(log, now);

  const issue = intFlag(flags, 'issue');
  if (env.simulateLimit && env.simulateLimit === flags.stage && issue) {
    const card = await loadCard(env, issue);
    if (!card.state.simulated.includes(flags.stage)) {
      verdict = {
        kind: 'usage_limit',
        resetAt: new Date(now.getTime() + 5 * 60 * 1000),
        message: 'Rehearsal: SDLC_SIMULATE_LIMIT made this run count as a usage limit.',
        sessionId: verdict.sessionId,
      };
      await saveCard(env, card, {
        state: { ...card.state, simulated: [...card.state.simulated, flags.stage] },
      });
    }
  }

  if (verdict.kind === 'ok') {
    const control = await loadControl(env);
    if (control && control.limitHits > 0 && !control.manual)
      await saveControl(env, { ...control, limitHits: 0 });
  }
  setOutput('kind', verdict.kind);
  setOutput('reset_at', verdict.resetAt?.toISOString() ?? '');
  setOutput('session_id', verdict.sessionId ?? '');
  setOutput('message', verdict.message);
  summary(
    `**Claude run:** ${verdict.kind}${verdict.message ? `: ${verdict.message.split('\n')[0]}` : ''}`,
  );
}

export async function pause(env: Env, flags: Flags): Promise<void> {
  const now = env.now();
  const work = workFrom(flags);
  const kind = flags.kind;
  const resetAt = flags['reset-at'] ? new Date(flags['reset-at']) : null;
  const issue = intFlag(flags, 'issue');
  const card = issue ? await loadCard(env, issue) : null;

  if (kind === 'usage_limit') {
    const control = await loadControl(env);
    const until = nextResume(now, resetAt, control?.limitHits ?? card?.state.limitHits ?? 0);
    if (control && !control.manual) {
      await saveControl(env, {
        ...control,
        pausedUntil: until.toISOString(),
        reason: 'usage limit',
        since: control.since ?? now.toISOString(),
        limitHits: control.limitHits + 1,
      });
    }
    summary(
      `**Usage limit reached.** The pipeline pauses until ${formatIst(until)} and then resumes on its own.`,
    );
    if (!card) return;
    const session =
      flags.session && flags.artifact
        ? {
            id: flags.session,
            runId: env.runId,
            artifact: flags.artifact,
            kind: work.kind,
            wip: true,
          }
        : card.state.session;
    await saveCard(env, card, {
      state: {
        ...deferWork(card.state, work, now),
        retryAfter: control ? null : until.toISOString(),
        limitHits: card.state.limitHits + 1,
        session,
      },
      stage: 'paused',
      note: `usage limit; resumes ~${formatIst(until)}`,
    });
    return;
  }

  // Overloaded, or a plain rate limit: wait a little, for this card only.
  if (!card) return;
  const retry = overloadedRetry(now, card.state.limitHits);
  await saveCard(env, card, {
    state: {
      ...deferWork(card.state, work, now),
      retryAfter: retry.toISOString(),
      limitHits: card.state.limitHits + 1,
    },
    stage: 'queued',
    note: `Claude was busy; retrying ~${formatIst(retry)}`,
  });
}

/** After a failed run that was not a limit: block the card with what went wrong. */
export async function failed(env: Env, flags: Flags): Promise<void> {
  const issue = intFlag(flags, 'issue');
  if (!issue) return;
  const card = await loadCard(env, issue);
  const work = workFrom(flags);
  const message = flags.message ?? process.env.SDLC_MESSAGE ?? '';
  const why =
    flags.kind === 'model_unavailable'
      ? 'the model an agent asks for is not available on this Claude plan (change its `model:` to `sonnet`)'
      : flags.kind === 'max_turns'
        ? `the ${work.kind} run used all its turns without finishing`
        : `the ${work.kind} run failed${message ? `: ${message.split('\n')[0]}` : ''}`;
  // The work in progress was saved as an artifact, so /resume carries on from it.
  const withSession =
    flags.session && flags.artifact
      ? {
          ...card,
          state: {
            ...card.state,
            session: {
              id: flags.session,
              runId: env.runId,
              artifact: flags.artifact,
              kind: work.kind,
              wip: true,
            },
          },
        }
      : card;
  await blockCard(env, withSession, why, work);
}

function structured<T>(): T {
  const raw = process.env.STRUCTURED_OUTPUT;
  if (!raw)
    throw new Error('STRUCTURED_OUTPUT is empty: the Claude run returned no structured output');
  return JSON.parse(raw) as T;
}

function sessionDir(): string {
  const dir = join(process.env.RUNNER_TEMP ?? '/tmp', 'sdlc');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export async function applyPlan(env: Env, flags: Flags): Promise<void> {
  const now = env.now();
  const issue = intFlag(flags, 'issue');
  if (!issue) throw new Error('--issue is required');
  const work = workFrom(flags);
  const card = await loadCard(env, issue);
  const plan = parsePlanOutput(process.env.STRUCTURED_OUTPUT ?? '');
  const labels = card.issue.labels.map((l) => l.name);
  const branch = branchName(changeTypeFor(plan.type, labels), issue, card.issue.title);
  const body = upsertPlan(
    card.issue.body,
    `${planHeader({ branch, size: plan.size, risk: plan.risk, runUrl: env.runUrl })}\n\n${plan.plan_markdown}`,
  );
  await updateIssue(env.gh, env.repo, issue, { body });
  if (!labels.includes(LABELS.sdlc.name))
    await addLabels(env.gh, env.repo, issue, [LABELS.sdlc.name]);

  // The context (not the plan) travels to the implementer as an artifact, with the session.
  const dir = sessionDir();
  writeFileSync(
    join(dir, 'context.json'),
    JSON.stringify({ issue, branch, ...plan.context }, null, 2),
  );
  const sessionId = flags.session || null;
  const saved = sessionId ? saveSession(dir, sessionId) : false;
  setOutput('artifact_dir', dir);

  const state = {
    ...card.state,
    branch,
    milestones: { ...card.state.milestones, planned: now.toISOString() },
    session:
      saved && sessionId
        ? {
            id: sessionId,
            runId: env.runId,
            artifact: `sdlc-plan-${issue}`,
            kind: 'plan' as const,
            wip: false,
          }
        : card.state.session,
  };

  if (plan.questions.length > 0) {
    await addComment(
      env.gh,
      env.repo,
      issue,
      [
        `@${env.owner} the plan is written, but a few things need your answer first:`,
        '',
        ...plan.questions.map((q, i) => `${i + 1}. ${q}`),
        '',
        'Reply here, then comment `/replan` to update the plan, or `/approve` to go ahead as it is.',
      ].join('\n'),
    );
    await saveCard(env, card, {
      state,
      status: 'todo',
      stage: 'needs_input',
      note: `${plan.questions.length} question(s)`,
    });
    return;
  }
  if (work.autoImplement) {
    await saveCard(env, card, {
      state,
      status: 'inProgress',
      stage: 'queued',
      note: 'planned; implementing next',
    });
    const next = dispatchFor({ kind: 'implement' }, issue);
    await dispatch(env.gh, env.repo, next.workflow, next.inputs);
    return;
  }
  await saveCard(env, card, {
    state,
    status: 'todo',
    stage: 'awaiting_approval',
    note: `size ${plan.size}, risk ${plan.risk}`,
  });
}

export async function afterImplement(env: Env, flags: Flags): Promise<void> {
  const now = env.now();
  const issue = intFlag(flags, 'issue');
  const branch = flags.branch;
  if (!issue || !branch) throw new Error('--issue and --branch are required');
  const card = await loadCard(env, issue);
  if (!isValidBranch(branch)) {
    await blockCard(
      env,
      card,
      `the branch \`${branch}\` does not follow the <type>/<issue>-<slug> convention`,
      null,
    );
    return;
  }
  const pr = await openPullForBranch(env.gh, env.repo, branch);
  if (!pr) {
    await blockCard(env, card, 'the implementation run ended without opening a pull request', {
      kind: 'implement',
    });
    return;
  }
  const details = await getPullRequest(env.gh, env.repo, pr);
  if (!details.linkedIssues.includes(issue)) {
    const current = await env.gh.rest<{ body: string | null }>(
      'GET',
      `/repos/${env.repo.owner}/${env.repo.name}/pulls/${pr}`,
    );
    await env.gh.rest('PATCH', `/repos/${env.repo.owner}/${env.repo.name}/pulls/${pr}`, {
      body: `Closes #${issue}\n\n${current.body ?? ''}`,
    });
  }
  await addLabels(env.gh, env.repo, pr, [LABELS.sdlc.name]);
  const sessionId = flags.session || null;
  const saved = sessionId ? saveSession(sessionDir(), sessionId) : false;
  setOutput('artifact_dir', sessionDir());
  setOutput('pr', pr);
  await saveCard(env, card, {
    state: {
      ...card.state,
      pr,
      branch,
      milestones: {
        ...card.state.milestones,
        prOpened: card.state.milestones.prOpened ?? now.toISOString(),
      },
      session:
        saved && sessionId
          ? {
              id: sessionId,
              runId: env.runId,
              artifact: `sdlc-session-${issue}`,
              kind: 'implement',
              wip: false,
            }
          : card.state.session,
    },
    status: 'inReview',
    stage: 'ci_running',
    note: `pull request #${pr}`,
  });
}

interface ReviewOutput {
  findings: Finding[];
  summary: string;
  resolved_thread_ids: string[];
}

/** A thread the AI review opened: its first comment carries the review marker. */
function isOwnThread(thread: ReviewThread): boolean {
  const first = thread.comments[0];
  return isPipelineComment(first?.author) && (first?.body.includes(REVIEW_MARKER) ?? false);
}

export async function afterReview(env: Env, flags: Flags): Promise<void> {
  const now = env.now();
  const prNumber = intFlag(flags, 'pr');
  if (!prNumber) throw new Error('--pr is required');
  const out = structured<ReviewOutput>();
  const pr = await getPullRequest(env.gh, env.repo, prNumber);
  const headSha = flags['head-sha'] || pr.headRefOid;

  // Only the review's own threads are closed by the review; people's threads are theirs.
  const threads = await listThreads(env.gh, env.repo, prNumber);
  const own = threads.filter(isOwnThread);
  const fixed = new Set(
    (out.resolved_thread_ids ?? []).filter((id) => own.some((t) => t.id === id)),
  );
  await resolveThreads(env.gh, [...fixed]);
  const stillOpen = own.filter(
    (t) => !t.isResolved && !fixed.has(t.id) && (t.comments[0]?.body.includes('🔴') ?? false),
  ).length;

  const findings = out.findings ?? [];
  const review = buildReview(findings, out.summary, await pullPatches(env.gh, env.repo, prNumber));
  await postReview(env.gh, env.repo, prNumber, headSha, review);
  const blocking = findings.filter((f) => f.severity === 'blocking').length + stillOpen;
  const nits = findings.filter((f) => f.severity === 'nit').length;
  summary(
    `**AI review:** ${blocking} blocking (${stillOpen} from earlier rounds), ${nits} nits, ${fixed.size} earlier thread(s) resolved.\n\n${out.summary}`,
  );

  const card = await boardCardForPr(env, pr);
  if (!card) return;
  if (blocking > 0) {
    const allowed = fixAllowed(card.state, 'review');
    if (!allowed.ok) {
      await blockCard(env, card, allowed.why ?? 'review findings remain', {
        kind: 'fix',
        reason: 'review',
        pr: prNumber,
      });
      return;
    }
    await saveCard(env, card, {
      state: { ...card.state, reviewRounds: card.state.reviewRounds + 1, aiReviewedSha: null },
      stage: 'addressing_review',
      note: `${blocking} blocking finding(s)`,
    });
    const next = dispatchFor({ kind: 'fix', reason: 'review', pr: prNumber }, card.issue.number);
    await dispatch(env.gh, env.repo, next.workflow, next.inputs);
    return;
  }
  await requestReview(env.gh, env.repo, prNumber, env.owner);
  await saveCard(env, card, {
    state: {
      ...card.state,
      aiReviewedSha: headSha,
      milestones: { ...card.state.milestones, aiReviewed: now.toISOString() },
    },
    stage: 'awaiting_your_approval',
    note: nits > 0 ? `AI review passed with ${nits} nit(s)` : 'AI review passed',
  });
  await mergeCheck(env, prNumber, { merge: true });
}

/** Writes the open review threads to a file for the reviewer or the fixer to read. */
export async function dumpThreads(env: Env, flags: Flags): Promise<void> {
  const prNumber = intFlag(flags, 'pr');
  if (!prNumber || !flags.out) throw new Error('--pr and --out are required');
  const threads = (await listThreads(env.gh, env.repo, prNumber))
    .filter((t) => !t.isResolved)
    .map((t) => ({ ...t, fromAiReview: isOwnThread(t) }));
  writeFileSync(flags.out, JSON.stringify(threads, null, 2));
  setOutput('count', threads.length);
}

interface FixOutput {
  verdict: 'fixed' | 'flaky' | 'unrelated' | 'bug_reported' | 'needs_human';
  summary: string;
  resolved_thread_ids: string[];
  replies: { comment_id: number; body: string }[];
  bug_issues: number[];
}

export async function afterFix(env: Env, flags: Flags): Promise<void> {
  const prNumber = intFlag(flags, 'pr');
  if (!prNumber) throw new Error('--pr is required');
  const work = workFrom(flags);
  const out = structured<FixOutput>();
  // Answer each thread first, then resolve the ones the push fixed.
  for (const reply of out.replies ?? []) {
    await replyToReviewComment(
      env.gh,
      env.repo,
      prNumber,
      reply.comment_id,
      withFooter(reply.body),
    ).catch((error: Error) =>
      console.warn(`Could not reply to comment ${reply.comment_id}: ${error.message}`),
    );
  }
  await resolveThreads(env.gh, out.resolved_thread_ids ?? []);
  const pr = await getPullRequest(env.gh, env.repo, prNumber);
  const card = await boardCardForPr(env, pr);
  if (!card) return;
  const sessionId = flags.session || null;
  const saved = sessionId ? saveSession(sessionDir(), sessionId) : false;
  setOutput('artifact_dir', sessionDir());
  const session =
    saved && sessionId
      ? {
          id: sessionId,
          runId: env.runId,
          artifact: `sdlc-session-${card.issue.number}`,
          kind: 'fix' as const,
          wip: false,
        }
      : card.state.session;
  const bugs = (out.bug_issues ?? []).map((n) => `#${n}`).join(', ');
  summary(`**Fix (${work.reason ?? 'review'}):** ${out.verdict}. ${out.summary}`);

  switch (out.verdict) {
    case 'fixed':
    case 'bug_reported':
      await saveCard(env, card, {
        state: { ...card.state, session },
        stage: 'ci_running',
        note: out.verdict === 'bug_reported' ? `fixed; reported ${bugs}` : 'fix pushed',
      });
      return;
    case 'flaky': {
      const runId = work.failedRunId;
      if (runId && card.state.flakyReruns < 1) {
        await rerunFailedJobs(env.gh, env.repo, runId);
        await saveCard(env, card, {
          state: {
            ...card.state,
            session,
            flakyReruns: card.state.flakyReruns + 1,
            ciFixes: Math.max(0, card.state.ciFixes - 1),
          },
          stage: 'ci_running',
          note: 'looked flaky; re-running the failed jobs once',
        });
        return;
      }
      await blockCard(
        env,
        card,
        `CI keeps failing in a way that looks flaky: ${out.summary}`,
        work,
      );
      return;
    }
    case 'unrelated':
      await addComment(
        env.gh,
        env.repo,
        prNumber,
        `The CI failure is not caused by this pull request.\n\n${out.summary}`,
      );
      await blockCard(
        env,
        card,
        `CI fails for a reason outside this pull request: ${out.summary}`,
        work,
      );
      return;
    case 'needs_human':
      await blockCard(env, card, out.summary, work);
      return;
  }
}
