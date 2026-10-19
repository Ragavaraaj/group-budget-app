import { describe, expect, it } from 'vitest';
import { AGENT_POLICY } from '../src/agent-policy.ts';
import { type ClaudeFile, lintClaude, parseFrontmatter } from '../src/lint-claude.ts';

function agent(
  name: string,
  fields: Record<string, string> = {},
  body = 'Does things.',
): ClaudeFile {
  const policy = AGENT_POLICY[name] ?? { model: 'sonnet', effort: 'high' };
  const all = {
    name,
    description: `The ${name}.`,
    tools: 'Read, Grep',
    model: policy.model,
    effort: policy.effort,
    ...fields,
  };
  const lines = Object.entries(all)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${k}: ${v}`);
  return {
    path: `.claude/agents/${name}.md`,
    content: `---\n${lines.join('\n')}\n---\n\n${body}\n`,
  };
}

function skill(name: string, body = 'Steps.'): ClaudeFile {
  return {
    path: `.claude/skills/${name}/SKILL.md`,
    content: `---\nname: ${name}\ndescription: Use for ${name}.\n---\n\n${body}\n`,
  };
}

const allAgents = () => Object.keys(AGENT_POLICY).map((name) => agent(name));

describe('parseFrontmatter', () => {
  it('reads single-line fields and the body', () => {
    expect(parseFrontmatter('---\nname: x\ndescription: "Quoted: yes"\n---\nBody\n')).toEqual({
      fields: { name: 'x', description: 'Quoted: yes' },
      body: 'Body\n',
    });
    expect(parseFrontmatter('no fences')).toBeNull();
  });
});

describe('lintClaude', () => {
  it('passes a complete, consistent set', () => {
    const files = [
      ...allAgents(),
      skill('sdlc-plan', 'Agents: `planner`\nSkills: `codebase-graph`'),
      skill('codebase-graph'),
    ];
    expect(lintClaude(files)).toEqual([]);
  });

  it('holds the planner and code reviewer on opus at xhigh, and everyone else on sonnet at high', () => {
    expect(AGENT_POLICY.planner).toEqual({ model: 'opus', effort: 'xhigh' });
    expect(AGENT_POLICY['code-reviewer']).toEqual({ model: 'opus', effort: 'xhigh' });
    for (const [name, policy] of Object.entries(AGENT_POLICY)) {
      if (name === 'planner' || name === 'code-reviewer') continue;
      expect(policy, name).toEqual({ model: 'sonnet', effort: 'high' });
    }
  });

  it('refuses an agent on the wrong model or effort, or with neither', () => {
    const files = allAgents().map((file) => {
      if (file.path.endsWith('/ui-engineer.md')) return agent('ui-engineer', { model: 'opus' });
      if (file.path.endsWith('/planner.md')) return agent('planner', { effort: 'high' });
      if (file.path.endsWith('/docs-writer.md'))
        return agent('docs-writer', { model: '', effort: '' });
      return file;
    });
    expect(lintClaude(files)).toEqual([
      '.claude/agents/planner.md: effort "high" should be "xhigh"',
      '.claude/agents/ui-engineer.md: model "opus" should be "sonnet"',
      '.claude/agents/docs-writer.md: no model (expected sonnet)',
      '.claude/agents/docs-writer.md: no effort (expected high)',
    ]);
  });

  it('refuses a full model id anywhere, in the model field or in the text', () => {
    const fullId = ['claude', 'sonnet', '0', '0'].join('-');
    const files = allAgents().map((file) =>
      file.path.endsWith('/ci-fixer.md') ? agent('ci-fixer', { model: fullId }) : file,
    );
    const problems = lintClaude([...files, skill('notes', `Run it with ${fullId}.`)]);
    expect(problems).toContain(
      '.claude/agents/ci-fixer.md: names a full model id; use a family alias (opus, sonnet)',
    );
    expect(problems).toContain(
      `.claude/agents/ci-fixer.md: model "${fullId}" is not an alias (opus, sonnet, haiku, inherit)`,
    );
    expect(problems).toContain(
      '.claude/skills/notes/SKILL.md: names a full model id; use a family alias (opus, sonnet)',
    );
  });

  it('wants every agent in the policy, and every policy entry to have an agent', () => {
    const files = [
      ...allAgents().filter((f) => !f.path.endsWith('/sync-engineer.md')),
      agent('stranger'),
    ];
    expect(lintClaude(files)).toEqual([
      '.claude/agents/stranger.md: not in tools/sdlc/src/agent-policy.ts; add its model and effort there',
      'agent-policy.ts lists "sync-engineer" but .claude/agents/sync-engineer.md is missing',
    ]);
  });

  it('checks names, descriptions, tools and frontmatter', () => {
    const files = [
      ...allAgents().map((file) =>
        file.path.endsWith('/test-engineer.md')
          ? agent('test-engineer', { name: 'tester', tools: '' })
          : file,
      ),
      { path: '.claude/skills/bare/SKILL.md', content: 'No frontmatter at all.' },
      { path: '.claude/skills/quiet/SKILL.md', content: '---\nname: quiet\n---\n' },
    ];
    expect(lintClaude(files)).toEqual([
      '.claude/agents/test-engineer.md: name "tester" should be "test-engineer"',
      '.claude/skills/bare/SKILL.md: no frontmatter (--- name/description ---)',
      '.claude/skills/quiet/SKILL.md: frontmatter has no description',
      '.claude/agents/test-engineer.md: no tools allow-list',
    ]);
  });

  it('finds references to agents and skills that do not exist', () => {
    const files = [
      ...allAgents(),
      skill('sdlc-review', '- **Agents:** `code-reviewer`, `perf-reviewer`\nSkills: `nowhere`'),
    ];
    expect(lintClaude(files)).toEqual([
      '.claude/skills/sdlc-review/SKILL.md: refers to agent `perf-reviewer`, which does not exist',
      '.claude/skills/sdlc-review/SKILL.md: refers to skill `nowhere`, which does not exist',
    ]);
  });

  it('checks the skills the workflows ask for', () => {
    const workflow = {
      path: '.github/workflows/sdlc-plan.yml',
      content: 'prompt: Use the `sdlc-plan` skill for issue #1',
    };
    expect(lintClaude(allAgents(), [workflow])).toEqual([
      '.github/workflows/sdlc-plan.yml: uses skill `sdlc-plan`, which does not exist',
    ]);
    expect(lintClaude([...allAgents(), skill('sdlc-plan')], [workflow])).toEqual([]);
  });
});
