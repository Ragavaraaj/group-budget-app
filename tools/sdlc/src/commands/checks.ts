/**
 * The two repository checks CI runs: `lint-claude` (agents and skills) and `check-bug-refs`
 * (every failing-on-purpose test names its bug issue). Both read the working tree and print one
 * line per problem.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkBugRefs, isTestPath } from '../bug-refs.ts';
import { type ClaudeFile, lintClaude } from '../lint-claude.ts';

function read(root: string, path: string): ClaudeFile {
  return { path, content: readFileSync(join(root, path), 'utf8') };
}

export function claudeFiles(root: string): { files: ClaudeFile[]; workflows: ClaudeFile[] } {
  const files: ClaudeFile[] = [];
  const agents = join(root, '.claude/agents');
  if (existsSync(agents)) {
    for (const name of readdirSync(agents)
      .filter((n) => n.endsWith('.md'))
      .sort()) {
      files.push(read(root, `.claude/agents/${name}`));
    }
  }
  const skills = join(root, '.claude/skills');
  if (existsSync(skills)) {
    for (const name of readdirSync(skills).sort()) {
      if (existsSync(join(skills, name, 'SKILL.md')))
        files.push(read(root, `.claude/skills/${name}/SKILL.md`));
    }
  }
  const workflowsDir = join(root, '.github/workflows');
  const workflows = existsSync(workflowsDir)
    ? readdirSync(workflowsDir)
        .filter((n) => n.startsWith('sdlc-') && n.endsWith('.yml'))
        .sort()
        .map((n) => read(root, `.github/workflows/${n}`))
    : [];
  return { files, workflows };
}

export function runLintClaude(root: string): number {
  const { files, workflows } = claudeFiles(root);
  const problems = lintClaude(files, workflows);
  for (const problem of problems) console.error(problem);
  if (problems.length === 0)
    console.log(`lint-claude: ${files.length} agent and skill files are fine.`);
  return problems.length === 0 ? 0 : 1;
}

export function runCheckBugRefs(root: string): number {
  const tracked = execFileSync('git', ['ls-files', '-z', '--', '*.ts'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\0')
    .filter((path) => path && isTestPath(path));
  const problems = checkBugRefs(
    tracked.map((path) => ({ path, content: readFileSync(join(root, path), 'utf8') })),
  );
  for (const problem of problems) console.error(problem);
  if (problems.length === 0) console.log(`check-bug-refs: ${tracked.length} test files are fine.`);
  return problems.length === 0 ? 0 : 1;
}
