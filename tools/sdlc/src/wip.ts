/**
 * Work in progress, carried between runs as an artifact so a usage limit never loses work: the
 * uncommitted changes, any commits not pushed yet, and the Claude session to resume. Also copies a
 * finished stage's session forward so the next stage carries on with its context.
 */
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';

function git(args: string[], options: { allowFail?: boolean } = {}): string {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    if (options.allowFail) return '';
    throw error;
  }
}

/** Where Claude Code keeps its session transcripts. */
export function sessionsRoot(): string {
  return join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
}

function findFiles(dir: string, name: string): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...findFiles(path, name));
    else if (entry === name) found.push(path);
  }
  return found;
}

/** Copies a session's transcript into `dir/session`, keeping its path under the sessions root. */
export function saveSession(dir: string, sessionId: string): boolean {
  const root = sessionsRoot();
  const files = findFiles(root, `${sessionId}.jsonl`);
  for (const file of files) {
    const target = join(dir, 'session', relative(root, file));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(file, target);
  }
  writeFileSync(join(dir, 'session.json'), JSON.stringify({ sessionId, saved: files.length > 0 }));
  return files.length > 0;
}

/** Puts a saved session back where Claude Code looks; returns its id, or null. */
export function restoreSession(dir: string): string | null {
  const metaPath = join(dir, 'session.json');
  if (!existsSync(metaPath)) return null;
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
    sessionId?: string;
    saved?: boolean;
  };
  if (!meta.sessionId || !meta.saved) return null;
  const from = join(dir, 'session');
  const root = sessionsRoot();
  for (const file of findFiles(from, `${meta.sessionId}.jsonl`)) {
    const target = join(root, relative(from, file));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(file, target);
  }
  return meta.sessionId;
}

export interface WipMeta {
  branch: string;
  head: string;
  base: string;
  hasCommits: boolean;
  hasChanges: boolean;
}

/** Saves the working tree's changes and unpushed commits into `dir`. */
export function saveWip(dir: string, sessionId: string | null): WipMeta {
  mkdirSync(dir, { recursive: true });
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const head = git(['rev-parse', 'HEAD']);
  const upstream = git(['rev-parse', '--verify', '--quiet', `origin/${branch}`], {
    allowFail: true,
  });
  const base = upstream ? `origin/${branch}` : 'origin/main';

  // Everything not committed, new files included (ignored files stay out).
  git(['add', '-A']);
  const patch = execFileSync('git', ['diff', '--cached', '--binary', 'HEAD'], {
    encoding: 'buffer',
  });
  const hasChanges = patch.length > 0;
  if (hasChanges) writeFileSync(join(dir, 'changes.patch'), patch);

  const ahead = Number(git(['rev-list', '--count', `${base}..HEAD`], { allowFail: true }) || 0);
  const hasCommits = ahead > 0;
  if (hasCommits) git(['bundle', 'create', join(dir, 'commits.bundle'), `${base}..HEAD`]);

  const meta: WipMeta = { branch, head, base, hasCommits, hasChanges };
  writeFileSync(join(dir, 'wip.json'), JSON.stringify(meta, null, 2));
  if (sessionId) saveSession(dir, sessionId);
  return meta;
}

/** Restores what `saveWip` saved onto a fresh checkout; returns the session to resume. */
export function restoreWip(dir: string): { branch: string | null; sessionId: string | null } {
  const metaPath = join(dir, 'wip.json');
  if (!existsSync(metaPath)) return { branch: null, sessionId: restoreSession(dir) };
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as WipMeta;
  if (meta.hasCommits) {
    git(['fetch', join(dir, 'commits.bundle'), 'HEAD']);
    git(['checkout', '-B', meta.branch, 'FETCH_HEAD']);
  } else if (meta.branch && meta.branch !== 'HEAD') {
    const remote = git(['rev-parse', '--verify', '--quiet', `origin/${meta.branch}`], {
      allowFail: true,
    });
    git(['checkout', '-B', meta.branch, remote ? `origin/${meta.branch}` : 'HEAD']);
  }
  if (meta.hasChanges) git(['apply', '--whitespace=nowarn', join(dir, 'changes.patch')]);
  return { branch: meta.branch, sessionId: restoreSession(dir) };
}
