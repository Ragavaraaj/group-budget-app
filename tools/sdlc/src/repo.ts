/**
 * What the pipeline reads and writes in the repository itself: issues and their comments, labels,
 * workflow runs and artifacts, and pull requests. All of it works with the workflow's own
 * `GITHUB_TOKEN`, except merging, which uses `SDLC_TOKEN` so the push to main starts CI and deploy.
 */

import type { MergeFacts, Review } from './decide.ts';
import type { GitHubClient } from './github.ts';
import { GitHubError, paginate } from './github.ts';
import { CLAUDE_WORKFLOWS } from './model.ts';

export interface Repo {
  owner: string;
  name: string;
}

export function parseRepo(full: string | undefined): Repo {
  const [owner, name] = (full ?? '').split('/');
  if (!owner || !name) throw new Error('GITHUB_REPOSITORY must be set to owner/name');
  return { owner, name };
}

const base = (r: Repo) => `/repos/${r.owner}/${r.name}`;

export interface Issue {
  number: number;
  node_id: string;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  labels: { name: string }[];
  user: { login: string } | null;
  pull_request?: unknown;
}

export interface Comment {
  id: number;
  body: string;
  user: { login: string; type: string } | null;
}

export async function getIssue(gh: GitHubClient, repo: Repo, number: number): Promise<Issue> {
  return gh.rest<Issue>('GET', `${base(repo)}/issues/${number}`);
}

export async function updateIssue(
  gh: GitHubClient,
  repo: Repo,
  number: number,
  changes: { body?: string; title?: string; state?: 'open' | 'closed'; state_reason?: string },
): Promise<void> {
  await gh.rest('PATCH', `${base(repo)}/issues/${number}`, changes);
}

export async function listComments(
  gh: GitHubClient,
  repo: Repo,
  number: number,
): Promise<Comment[]> {
  return paginate<Comment>(gh, `${base(repo)}/issues/${number}/comments`);
}

export async function addComment(
  gh: GitHubClient,
  repo: Repo,
  number: number,
  body: string,
): Promise<number> {
  const created = await gh.rest<{ id: number }>('POST', `${base(repo)}/issues/${number}/comments`, {
    body,
  });
  return created.id;
}

export async function editComment(
  gh: GitHubClient,
  repo: Repo,
  id: number,
  body: string,
): Promise<void> {
  await gh.rest('PATCH', `${base(repo)}/issues/comments/${id}`, { body });
}

/** Only comments the workflow itself wrote are trusted to carry state. */
export function isPipelineComment(login: string | null | undefined): boolean {
  return login === 'github-actions[bot]' || login === 'github-actions';
}

export async function ensureLabel(
  gh: GitHubClient,
  repo: Repo,
  label: { name: string; color: string; description: string },
): Promise<'created' | 'updated'> {
  try {
    await gh.rest('POST', `${base(repo)}/labels`, label);
    return 'created';
  } catch (error) {
    if (!(error instanceof GitHubError && error.status === 422)) throw error;
    // It exists (perhaps made on the fly, grey and undescribed): give it the right colour and text.
    await gh.rest('PATCH', `${base(repo)}/labels/${encodeURIComponent(label.name)}`, {
      color: label.color,
      description: label.description,
    });
    return 'updated';
  }
}

export async function addLabels(
  gh: GitHubClient,
  repo: Repo,
  number: number,
  labels: string[],
): Promise<void> {
  await gh.rest('POST', `${base(repo)}/issues/${number}/labels`, { labels });
}

export async function removeLabel(
  gh: GitHubClient,
  repo: Repo,
  number: number,
  label: string,
): Promise<void> {
  try {
    await gh.rest('DELETE', `${base(repo)}/issues/${number}/labels/${encodeURIComponent(label)}`);
  } catch (error) {
    if (!(error instanceof GitHubError && error.status === 404)) throw error;
  }
}

export async function repositoryId(gh: GitHubClient, repo: Repo): Promise<string> {
  const data = await gh.rest<{ node_id: string; default_branch: string }>('GET', base(repo));
  return data.node_id;
}

/** Starts a workflow on main with inputs. Allowed with `GITHUB_TOKEN`, unlike most events. */
export async function dispatch(
  gh: GitHubClient,
  repo: Repo,
  workflow: string,
  inputs: Record<string, string>,
  ref = 'main',
): Promise<void> {
  await gh.rest('POST', `${base(repo)}/actions/workflows/${workflow}/dispatches`, { ref, inputs });
}

interface Run {
  id: number;
  path: string;
  status: string;
  conclusion: string | null;
  head_sha: string;
  created_at: string;
}

/** Claude jobs running now, not counting this run and anything that started after it. */
export async function runningClaudeJobs(
  gh: GitHubClient,
  repo: Repo,
  currentRunId: number,
): Promise<number> {
  const data = await gh.rest<{ workflow_runs: Run[] }>(
    'GET',
    `${base(repo)}/actions/runs?status=in_progress&per_page=100`,
  );
  return data.workflow_runs.filter(
    (run) =>
      CLAUDE_WORKFLOWS.some((file) => run.path.endsWith(`/${file}`)) &&
      run.id !== currentRunId &&
      (currentRunId === 0 || run.id < currentRunId),
  ).length;
}

/** The newest unexpired artifact with this name, and the run that made it. */
export async function latestArtifact(
  gh: GitHubClient,
  repo: Repo,
  name: string,
): Promise<{ id: number; runId: number } | null> {
  const data = await gh.rest<{
    artifacts: {
      id: number;
      expired: boolean;
      created_at: string;
      workflow_run: { id: number } | null;
    }[];
  }>('GET', `${base(repo)}/actions/artifacts?name=${encodeURIComponent(name)}&per_page=10`);
  const live = data.artifacts
    .filter((a) => !a.expired && a.workflow_run)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const newest = live[0];
  return newest?.workflow_run ? { id: newest.id, runId: newest.workflow_run.id } : null;
}

/** The latest CI run on a commit: success, failure, pending, or missing when CI has not started. */
export async function ciOnCommit(
  gh: GitHubClient,
  repo: Repo,
  sha: string,
): Promise<MergeFacts['ci']> {
  const data = await gh.rest<{ workflow_runs: Run[] }>(
    'GET',
    `${base(repo)}/actions/workflows/ci.yml/runs?head_sha=${sha}&per_page=5`,
  );
  const latest = [...data.workflow_runs].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  )[0];
  if (!latest) return 'missing';
  if (latest.status !== 'completed') return 'pending';
  return latest.conclusion === 'success' ? 'success' : 'failure';
}

export interface PullRequest {
  number: number;
  title: string;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  isDraft: boolean;
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  headRefName: string;
  headRefOid: string;
  headRepo: string | null;
  author: string | null;
  labels: string[];
  linkedIssues: number[];
  unresolvedThreads: number;
  reviews: Review[];
}

export async function getPullRequest(
  gh: GitHubClient,
  repo: Repo,
  number: number,
): Promise<PullRequest> {
  const data = await gh.graphql<{
    repository: {
      pullRequest: {
        number: number;
        title: string;
        state: PullRequest['state'];
        isDraft: boolean;
        mergeable: PullRequest['mergeable'];
        headRefName: string;
        headRefOid: string;
        headRepository: { nameWithOwner: string } | null;
        author: { login: string } | null;
        labels: { nodes: { name: string }[] };
        closingIssuesReferences: { nodes: { number: number }[] };
        reviewThreads: { nodes: { isResolved: boolean }[] };
        latestOpinionatedReviews: {
          nodes: {
            state: Review['state'];
            authorCanPushToRepository: boolean;
            author: { login: string; __typename: string } | null;
            commit: { oid: string } | null;
          }[];
        };
      } | null;
    };
  }>(
    `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        number title state isDraft mergeable headRefName headRefOid
        headRepository { nameWithOwner } author { login }
        labels(first: 30) { nodes { name } }
        closingIssuesReferences(first: 10) { nodes { number } }
        reviewThreads(first: 100) { nodes { isResolved } }
        latestOpinionatedReviews(first: 50) { nodes {
          state authorCanPushToRepository author { login __typename } commit { oid } } }
      } } }`,
    { owner: repo.owner, name: repo.name, number },
  );
  const pr = data.repository.pullRequest;
  if (!pr) throw new Error(`No pull request #${number}`);
  return {
    number: pr.number,
    title: pr.title,
    state: pr.state,
    isDraft: pr.isDraft,
    mergeable: pr.mergeable,
    headRefName: pr.headRefName,
    headRefOid: pr.headRefOid,
    headRepo: pr.headRepository?.nameWithOwner ?? null,
    author: pr.author?.login ?? null,
    labels: pr.labels.nodes.map((l) => l.name),
    linkedIssues: pr.closingIssuesReferences.nodes.map((n) => n.number),
    unresolvedThreads: pr.reviewThreads.nodes.filter((t) => !t.isResolved).length,
    reviews: pr.latestOpinionatedReviews.nodes.map((r) => ({
      state: r.state,
      author: r.author?.login ?? '',
      isBot: r.author?.__typename === 'Bot' || (r.author?.login ?? '').endsWith('[bot]'),
      canPush: r.authorCanPushToRepository,
      commitSha: r.commit?.oid ?? null,
    })),
  };
}

export async function openPullForBranch(
  gh: GitHubClient,
  repo: Repo,
  branch: string,
): Promise<number | null> {
  const pulls = await gh.rest<{ number: number }[]>(
    'GET',
    `${base(repo)}/pulls?state=open&head=${encodeURIComponent(`${repo.owner}:${branch}`)}`,
  );
  return pulls[0]?.number ?? null;
}

export async function pullsForCommit(gh: GitHubClient, repo: Repo, sha: string): Promise<number[]> {
  const pulls = await gh.rest<{ number: number; merged_at: string | null }[]>(
    'GET',
    `${base(repo)}/commits/${sha}/pulls`,
  );
  return pulls.filter((p) => p.merged_at).map((p) => p.number);
}

export async function resolveThreads(gh: GitHubClient, ids: string[]): Promise<number> {
  let resolved = 0;
  for (const id of ids) {
    try {
      await gh.graphql(
        `mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { thread { isResolved } } }`,
        { id },
      );
      resolved++;
    } catch (error) {
      console.warn(`Could not resolve thread ${id}: ${(error as Error).message}`);
    }
  }
  return resolved;
}

export async function requestReview(
  gh: GitHubClient,
  repo: Repo,
  pr: number,
  reviewer: string,
): Promise<void> {
  try {
    await gh.rest('POST', `${base(repo)}/pulls/${pr}/requested_reviewers`, {
      reviewers: [reviewer],
    });
  } catch (error) {
    // Already requested, or the reviewer is the author: neither is worth failing for.
    console.warn(`Could not request a review from ${reviewer}: ${(error as Error).message}`);
  }
}

export async function rerunFailedJobs(gh: GitHubClient, repo: Repo, runId: number): Promise<void> {
  await gh.rest('POST', `${base(repo)}/actions/runs/${runId}/rerun-failed-jobs`);
}

/** Merges with a merge commit (the repo's history uses them), only if the head is still `sha`. */
export async function mergePullRequest(
  pat: GitHubClient,
  repo: Repo,
  pr: number,
  sha: string,
  title: string,
): Promise<{ merged: boolean; message: string }> {
  try {
    const result = await pat.rest<{ merged: boolean; message: string }>(
      'PUT',
      `${base(repo)}/pulls/${pr}/merge`,
      { merge_method: 'merge', sha, commit_title: `Merge pull request #${pr}: ${title}` },
    );
    return result;
  } catch (error) {
    return { merged: false, message: (error as Error).message };
  }
}

export async function searchIssues(
  gh: GitHubClient,
  repo: Repo,
  query: string,
): Promise<{ number: number; node_id: string; state: string; title: string }[]> {
  const q = encodeURIComponent(`repo:${repo.owner}/${repo.name} ${query}`);
  const data = await gh.rest<{
    items: { number: number; node_id: string; state: string; title: string }[];
  }>('GET', `/search/issues?q=${q}&per_page=100`);
  return data.items;
}

export async function createIssue(
  gh: GitHubClient,
  repo: Repo,
  issue: { title: string; body: string; labels: string[] },
): Promise<Issue> {
  return gh.rest<Issue>('POST', `${base(repo)}/issues`, issue);
}

export interface ReviewThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  comments: { id: number; author: string | null; body: string }[];
}

/** The review threads of a pull request, for the reviewer and the fixer to read. */
export async function listThreads(
  gh: GitHubClient,
  repo: Repo,
  pr: number,
): Promise<ReviewThread[]> {
  const data = await gh.graphql<{
    repository: {
      pullRequest: {
        reviewThreads: {
          nodes: {
            id: string;
            isResolved: boolean;
            isOutdated: boolean;
            path: string;
            line: number | null;
            comments: {
              nodes: { databaseId: number; body: string; author: { login: string } | null }[];
            };
          }[];
        };
      } | null;
    };
  }>(
    `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) {
      pullRequest(number: $number) { reviewThreads(first: 100) { nodes {
        id isResolved isOutdated path line
        comments(first: 30) { nodes { databaseId body author { login } } }
      } } } } }`,
    { owner: repo.owner, name: repo.name, number: pr },
  );
  return (data.repository.pullRequest?.reviewThreads.nodes ?? []).map((t) => ({
    id: t.id,
    isResolved: t.isResolved,
    isOutdated: t.isOutdated,
    path: t.path,
    line: t.line,
    comments: t.comments.nodes.map((c) => ({
      id: c.databaseId,
      author: c.author?.login ?? null,
      body: c.body,
    })),
  }));
}

/** Each changed file's patch, keyed by path, to know which lines can take an inline comment. */
export async function pullPatches(
  gh: GitHubClient,
  repo: Repo,
  pr: number,
): Promise<Record<string, string | undefined>> {
  const files = await paginate<{ filename: string; patch?: string }>(
    gh,
    `${base(repo)}/pulls/${pr}/files`,
    3000,
  );
  return Object.fromEntries(files.map((f) => [f.filename, f.patch]));
}

export async function postReview(
  gh: GitHubClient,
  repo: Repo,
  pr: number,
  sha: string,
  review: { body: string; comments: { path: string; line: number; side: 'RIGHT'; body: string }[] },
): Promise<void> {
  await gh.rest('POST', `${base(repo)}/pulls/${pr}/reviews`, {
    commit_id: sha,
    event: 'COMMENT',
    body: review.body,
    comments: review.comments,
  });
}

export async function replyToReviewComment(
  gh: GitHubClient,
  repo: Repo,
  pr: number,
  commentId: number,
  body: string,
): Promise<void> {
  await gh.rest('POST', `${base(repo)}/pulls/${pr}/comments/${commentId}/replies`, { body });
}
