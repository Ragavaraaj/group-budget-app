/**
 * The last step: merging a board pull request once everything the gate asks for holds, with the
 * personal token so the push to main runs CI and deploys. Also marks cards deployed afterwards.
 */
import { boardCardForPr, loadCard, saveCard } from '../card.ts';
import { evaluateMergeGate, type MergeFacts } from '../decide.ts';
import { type Env, intFlag, summary } from '../env.ts';
import { ciOnCommit, dispatch, getPullRequest, mergePullRequest, pullsForCommit } from '../repo.ts';
import { dispatchFor } from '../work.ts';

export async function mergeCheck(
  env: Env,
  prNumber: number,
  options: { merge: boolean },
): Promise<boolean> {
  const now = env.now();
  const pr = await getPullRequest(env.gh, env.repo, prNumber);
  const card = await boardCardForPr(env, pr);
  if (!card) {
    summary(`#${prNumber} is not a board pull request; the pipeline does not merge it.`);
    return false;
  }
  const ci = await ciOnCommit(env.gh, env.repo, pr.headRefOid);
  const facts: MergeFacts = {
    number: pr.number,
    state: pr.state,
    isDraft: pr.isDraft,
    fromThisRepo: pr.headRepo === `${env.repo.owner}/${env.repo.name}`,
    headSha: pr.headRefOid,
    mergeable: pr.mergeable,
    linkedIssues: pr.linkedIssues,
    boardIssue: card.issue.number,
    ci,
    unresolvedThreads: pr.unresolvedThreads,
    reviews: pr.reviews,
    aiReviewedSha: card.state.aiReviewedSha,
  };
  const gate = evaluateMergeGate(facts);

  // Progress that is true whatever the gate says.
  const milestones = { ...card.state.milestones };
  let { ciFixes, flakyReruns } = card.state;
  if (ci === 'success') {
    milestones.ciGreen = now.toISOString();
    ciFixes = 0;
    flakyReruns = 0;
  }
  const approved = pr.reviews.some(
    (r) => !r.isBot && r.canPush && r.state === 'APPROVED' && r.commitSha === pr.headRefOid,
  );
  if (approved) milestones.ownerApproved = milestones.ownerApproved ?? now.toISOString();
  const state = { ...card.state, milestones, ciFixes, flakyReruns };

  summary(
    gate.ok
      ? `**Merge gate for #${prNumber}: open.**`
      : `**Merge gate for #${prNumber}: waiting.**\n\n${gate.reasons.map((r) => `- ${r}`).join('\n')}`,
  );
  if (!gate.ok) {
    if (pr.mergeable === 'CONFLICTING' && card.state.stage !== 'resolving_conflict') {
      const next = dispatchFor(
        { kind: 'fix', reason: 'conflict', pr: prNumber },
        card.issue.number,
      );
      await dispatch(env.gh, env.repo, next.workflow, next.inputs);
    }
    const onlyPeople = gate.reasons.every((r) => /approv/.test(r));
    const changed =
      JSON.stringify(state.milestones) !== JSON.stringify(card.state.milestones) ||
      ciFixes !== card.state.ciFixes;
    if (changed || (onlyPeople && card.state.stage !== 'awaiting_your_approval')) {
      await saveCard(env, card, {
        state,
        ...(onlyPeople ? { stage: 'awaiting_your_approval' as const } : {}),
        note: gate.reasons[0],
      });
    }
    return false;
  }
  if (!options.merge) return true;
  if (!env.pat) {
    summary('The gate is open, but `SDLC_TOKEN` is not set, so the pipeline cannot merge.');
    return false;
  }

  const merging = await saveCard(env, card, {
    state,
    stage: 'merging',
    note: `merging #${prNumber}`,
  });
  const result = await mergePullRequest(env.pat, env.repo, prNumber, pr.headRefOid, pr.title);
  if (!result.merged) {
    summary(`Merging #${prNumber} failed: ${result.message}`);
    await saveCard(env, merging, {
      stage: 'awaiting_your_approval',
      note: `merge refused: ${result.message}`,
    });
    return false;
  }
  await saveCard(env, merging, {
    state: {
      ...merging.state,
      milestones: { ...merging.state.milestones, merged: now.toISOString() },
    },
    status: 'done',
    stage: 'merged',
    note: `merged #${prNumber}; deploying`,
  });
  return true;
}

export async function mergeCommand(env: Env, flags: Record<string, string>): Promise<void> {
  const pr = intFlag(flags, 'pr');
  if (!pr) throw new Error('--pr is required');
  if (!env.enabled) return;
  await mergeCheck(env, pr, { merge: flags.merge === 'true' });
}

/** After CI on main: the cards whose pull requests that commit merged are deployed (or not). */
export async function deployed(env: Env, flags: Record<string, string>): Promise<void> {
  const sha = flags.sha;
  if (!sha) throw new Error('--sha is required');
  const ok = flags.conclusion === 'success';
  const now = env.now();
  for (const prNumber of await pullsForCommit(env.gh, env.repo, sha)) {
    const pr = await getPullRequest(env.gh, env.repo, prNumber);
    for (const issue of pr.linkedIssues) {
      const card = await loadCard(env, issue);
      if (!card.itemId && !card.state.pr) continue;
      await saveCard(env, card, {
        state: ok
          ? { ...card.state, milestones: { ...card.state.milestones, deployed: now.toISOString() } }
          : card.state,
        status: 'done',
        stage: ok ? 'deployed' : 'deploy_failed',
        note: ok
          ? `deployed ${sha.slice(0, 7)}`
          : `the deploy of ${sha.slice(0, 7)} failed; see the CI run`,
      });
    }
  }
}
