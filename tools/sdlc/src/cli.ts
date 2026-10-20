#!/usr/bin/env node
/**
 * The pipeline's command line, called from the workflows in `.github/workflows/sdlc-*.yml`:
 *
 *   node tools/sdlc/src/cli.ts <command> [--flag value ...]
 *
 * Board and run commands need GITHUB_TOKEN (and SDLC_TOKEN with PROJECT_NUMBER for the board);
 * `lint-claude`, `check-bug-refs` and `branch-name` need nothing and also run locally.
 */
import { execFileSync } from 'node:child_process';
import { branchName, changeTypeFor } from './branch.ts';
import { runCheckBugRefs, runLintClaude } from './commands/checks.ts';
import { doctor } from './commands/doctor.ts';
import { boardEvent, commentCommand } from './commands/events.ts';
import { deployed, mergeCommand } from './commands/merge.ts';
import { poll } from './commands/poll.ts';
import {
  afterFix,
  afterImplement,
  afterReview,
  applyPlan,
  classify,
  dumpThreads,
  failed,
  gate,
  pause,
} from './commands/stage.ts';
import { intFlag, loadEnv, parseArgs, setOutput } from './env.ts';
import { restoreWip, saveWip } from './wip.ts';

const HELP = `Usage: node tools/sdlc/src/cli.ts <command> [flags]

Checks (no tokens needed)
  lint-claude                    check .claude/agents and .claude/skills
  check-bug-refs                 every test.fail(...) names its bug issue
  branch-name --issue N --title T [--type feat|fix|test|chore] [--labels a,b]

Board
  doctor                         check and set up the board, labels and control issue
  poll [--dry-run]               the ten-minute sweep over the board
  board-event                    react to an issues / pull_request event
  comment-command                handle /resume, /resume-now and /pause

Around a Claude run
  gate --stage plan|implement|review|fix [--issue N | --pr N] [--reason ci|review|conflict]
  classify-run --file EXECUTION_FILE --stage S [--issue N]
  pause --kind usage_limit|overloaded --issue N [--reset-at ISO] [--session ID --artifact NAME]
  failed --issue N --kind K [--message M]
  apply-plan --issue N [--session ID]
  after-implement --issue N --branch B [--session ID]
  after-review --pr N [--head-sha SHA]
  after-fix --pr N [--session ID]
  threads --pr N --out FILE     the open review threads, for the reviewer and fixer
  merge --pr N [--merge]
  deployed --sha SHA --conclusion success|failure
  save-wip --dir D [--session ID] / restore-wip --dir D`;

function repoRoot(): string {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    return process.cwd();
  }
}

async function main(argv: string[]): Promise<number> {
  const { command, flags } = parseArgs(argv);
  switch (command) {
    case 'lint-claude':
      return runLintClaude(repoRoot());
    case 'check-bug-refs':
      return runCheckBugRefs(repoRoot());
    case 'branch-name': {
      const issue = intFlag(flags, 'issue');
      if (!issue || !flags.title) throw new Error('--issue and --title are required');
      const labels = (flags.labels ?? '').split(',').filter(Boolean);
      const name = branchName(changeTypeFor(flags.type, labels), issue, flags.title);
      setOutput('branch', name);
      console.log(name);
      return 0;
    }
    case 'save-wip': {
      if (!flags.dir) throw new Error('--dir is required');
      const meta = saveWip(flags.dir, flags.session || null);
      setOutput('saved', meta.hasChanges || meta.hasCommits ? 'true' : 'false');
      return 0;
    }
    case 'restore-wip': {
      if (!flags.dir) throw new Error('--dir is required');
      const restored = restoreWip(flags.dir);
      setOutput('branch', restored.branch ?? '');
      setOutput('session', restored.sessionId ?? '');
      return 0;
    }
    case 'help':
    case '--help':
      console.log(HELP);
      return 0;
  }

  const env = loadEnv();
  switch (command) {
    case 'doctor':
      return (await doctor(env)) ? 0 : 1;
    case 'poll':
      await poll(env, flags);
      return 0;
    case 'board-event':
      await boardEvent(env);
      return 0;
    case 'comment-command':
      await commentCommand(env);
      return 0;
    case 'gate':
      await gate(env, flags);
      return 0;
    case 'classify-run':
      await classify(env, flags);
      return 0;
    case 'pause':
      await pause(env, flags);
      return 0;
    case 'failed':
      await failed(env, flags);
      return 0;
    case 'apply-plan':
      await applyPlan(env, flags);
      return 0;
    case 'after-implement':
      await afterImplement(env, flags);
      return 0;
    case 'after-review':
      await afterReview(env, flags);
      return 0;
    case 'after-fix':
      await afterFix(env, flags);
      return 0;
    case 'merge':
      await mergeCommand(env, flags);
      return 0;
    case 'deployed':
      await deployed(env, flags);
      return 0;
    case 'threads':
      await dumpThreads(env, flags);
      return 0;
    default:
      console.error(`Unknown command "${command}".\n\n${HELP}`);
      return 2;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: Error) => {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  },
);
