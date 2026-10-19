/**
 * Everything a command needs from the Actions environment, read once: the repository, the two
 * tokens, the board's number, this run's link, and the pipeline's settings (repository variables).
 */

import { randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { createClient, type GitHubClient } from './github.ts';
import { parseRepo, type Repo } from './repo.ts';

export interface Env {
  repo: Repo;
  /** The workflow's own token: issues, comments, labels, dispatches, reviews. */
  gh: GitHubClient;
  /** `SDLC_TOKEN`, a personal token with the `project` scope: the board, and merging. */
  pat: GitHubClient | null;
  projectOwner: string;
  projectNumber: number | null;
  runId: number;
  runUrl: string | null;
  /** The person who owns the board, mentioned when a card is blocked and asked for reviews. */
  owner: string;
  enabled: boolean;
  maxParallel: number;
  simulateLimit: string | null;
  reviewDepth: 'full' | 'light';
  now: () => Date;
}

export function loadEnv(): Env {
  const e = process.env;
  const repo = parseRepo(e.GITHUB_REPOSITORY);
  const token = e.GITHUB_TOKEN ?? e.GH_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is not set');
  const runId = Number(e.GITHUB_RUN_ID ?? 0);
  const server = e.GITHUB_SERVER_URL ?? 'https://github.com';
  const projectNumber = Number(e.PROJECT_NUMBER);
  return {
    repo,
    gh: createClient(token),
    pat: e.SDLC_TOKEN ? createClient(e.SDLC_TOKEN) : null,
    projectOwner: e.PROJECT_OWNER || repo.owner,
    projectNumber: Number.isInteger(projectNumber) && projectNumber > 0 ? projectNumber : null,
    runId,
    runUrl: runId ? `${server}/${repo.owner}/${repo.name}/actions/runs/${runId}` : null,
    owner: e.SDLC_OWNER || repo.owner,
    enabled: (e.SDLC_ENABLED ?? '').toLowerCase() !== 'false',
    maxParallel: Math.max(1, Number(e.SDLC_MAX_PARALLEL) || 1),
    simulateLimit: e.SDLC_SIMULATE_LIMIT || null,
    reviewDepth: e.SDLC_REVIEW_DEPTH === 'light' ? 'light' : 'full',
    now: () => new Date(),
  };
}

/** Writes a step output, using a delimiter so multi-line values survive. */
export function setOutput(name: string, value: string | number | boolean | null | undefined): void {
  const text = value === null || value === undefined ? '' : String(value);
  const file = process.env.GITHUB_OUTPUT;
  if (!file) {
    console.log(`::output ${name}=${text}`);
    return;
  }
  const delimiter = `sdlc_${randomUUID()}`;
  appendFileSync(file, `${name}<<${delimiter}\n${text}\n${delimiter}\n`);
}

export function summary(markdown: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, `${markdown}\n`);
  else console.log(markdown);
}

export function readEvent<T>(): T {
  const path = process.env.GITHUB_EVENT_PATH;
  if (!path) throw new Error('GITHUB_EVENT_PATH is not set');
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** `--name value` and `--flag` arguments. */
export function parseArgs(argv: string[]): { command: string; flags: Record<string, string> } {
  const [command = 'help', ...rest] = argv;
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] as string;
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) flags[key] = 'true';
    else {
      flags[key] = next;
      i++;
    }
  }
  return { command, flags };
}

export function intFlag(flags: Record<string, string>, name: string): number | null {
  const value = Number(flags[name]);
  return Number.isInteger(value) && value > 0 ? value : null;
}
