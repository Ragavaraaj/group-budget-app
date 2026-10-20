/**
 * Checks `.claude/agents` and `.claude/skills` so a broken or drifting definition fails CI instead
 * of failing an Actions run at three in the morning: frontmatter present, names unique and matching
 * their files, references resolvable, and every agent on the model and effort its policy says.
 */
import { AGENT_POLICY, MODEL_ALIASES } from './agent-policy.ts';

export interface ClaudeFile {
  /** Repo-relative path, e.g. `.claude/agents/planner.md` or `.claude/skills/x/SKILL.md`. */
  path: string;
  content: string;
}

export interface Frontmatter {
  fields: Record<string, string>;
  body: string;
}

/** Reads `key: value` lines between `---` fences. Values are single-line, as the files use. */
export function parseFrontmatter(content: string): Frontmatter | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
  if (!match) return null;
  const fields: Record<string, string> = {};
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv?.[1]) fields[kv[1]] = (kv[2] ?? '').trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return { fields, body: match[2] ?? '' };
}

/** A full model id such as `claude-<family>-<version>`; only aliases belong in these files. */
const MODEL_ID = /\bclaude-(?:opus|sonnet|haiku|fable|instant)[-\w.]*\d/i;

/** Names a file lists on its `Agents:` and `Skills:` lines, in backticks. */
function references(body: string, label: 'Agents' | 'Skills'): string[] {
  const names: string[] = [];
  const re = new RegExp(`^\\s*(?:[-*]\\s*)?\\**${label}:\\**(.*)$`, 'gm');
  for (const line of body.matchAll(re)) {
    for (const name of (line[1] ?? '').matchAll(/`([a-z0-9-]+)`/g)) {
      if (name[1]) names.push(name[1]);
    }
  }
  return names;
}

export function lintClaude(files: ClaudeFile[], workflows: ClaudeFile[] = []): string[] {
  const problems: string[] = [];
  const agents = new Map<string, Frontmatter>();
  const skills = new Map<string, Frontmatter>();

  for (const file of files) {
    const agentMatch = /^\.claude\/agents\/([^/]+)\.md$/.exec(file.path);
    const skillMatch = /^\.claude\/skills\/([^/]+)\/SKILL\.md$/.exec(file.path);
    if (!agentMatch && !skillMatch) continue;
    const expected = (agentMatch?.[1] ?? skillMatch?.[1]) as string;
    const fm = parseFrontmatter(file.content);
    if (!fm) {
      problems.push(`${file.path}: no frontmatter (--- name/description ---)`);
      continue;
    }
    const { name, description } = fm.fields;
    if (!name) problems.push(`${file.path}: frontmatter has no name`);
    else if (name !== expected)
      problems.push(`${file.path}: name "${name}" should be "${expected}"`);
    if (!description) problems.push(`${file.path}: frontmatter has no description`);
    if (MODEL_ID.test(file.content)) {
      problems.push(`${file.path}: names a full model id; use a family alias (opus, sonnet)`);
    }
    const registry = agentMatch ? agents : skills;
    if (registry.has(expected)) problems.push(`${file.path}: duplicate name "${expected}"`);
    registry.set(expected, fm);
  }

  for (const [name, fm] of agents) {
    const path = `.claude/agents/${name}.md`;
    const policy = AGENT_POLICY[name];
    const { model, effort, tools } = fm.fields;
    if (!policy) {
      problems.push(
        `${path}: not in tools/sdlc/src/agent-policy.ts; add its model and effort there`,
      );
      continue;
    }
    if (!model) problems.push(`${path}: no model (expected ${policy.model})`);
    else if (!(MODEL_ALIASES as readonly string[]).includes(model)) {
      problems.push(`${path}: model "${model}" is not an alias (${MODEL_ALIASES.join(', ')})`);
    } else if (model !== policy.model) {
      problems.push(`${path}: model "${model}" should be "${policy.model}"`);
    }
    if (!effort) problems.push(`${path}: no effort (expected ${policy.effort})`);
    else if (effort !== policy.effort)
      problems.push(`${path}: effort "${effort}" should be "${policy.effort}"`);
    if (!tools) problems.push(`${path}: no tools allow-list`);
  }
  for (const name of Object.keys(AGENT_POLICY)) {
    if (!agents.has(name))
      problems.push(`agent-policy.ts lists "${name}" but .claude/agents/${name}.md is missing`);
  }

  const all = [...agents].map(([n, fm]) => ({ path: `.claude/agents/${n}.md`, fm }));
  all.push(...[...skills].map(([n, fm]) => ({ path: `.claude/skills/${n}/SKILL.md`, fm })));
  for (const { path, fm } of all) {
    for (const ref of references(fm.body, 'Agents')) {
      if (!agents.has(ref))
        problems.push(`${path}: refers to agent \`${ref}\`, which does not exist`);
    }
    for (const ref of references(fm.body, 'Skills')) {
      if (!skills.has(ref))
        problems.push(`${path}: refers to skill \`${ref}\`, which does not exist`);
    }
  }

  for (const workflow of workflows) {
    for (const match of workflow.content.matchAll(/the `([a-z0-9-]+)` skill/g)) {
      const ref = match[1] as string;
      if (!skills.has(ref))
        problems.push(`${workflow.path}: uses skill \`${ref}\`, which does not exist`);
    }
  }
  return problems;
}
