/**
 * Which model and effort each custom agent in `.claude/agents` runs with. The planner and the code
 * reviewer get the strongest model at extra-high effort; everything else runs on the faster model
 * at high effort. Family aliases only: they follow each family's newest release, and the repo never
 * pins an exact model id.
 */

export interface AgentPolicy {
  model: 'opus' | 'sonnet';
  effort: 'high' | 'xhigh';
}

export const AGENT_POLICY: Record<string, AgentPolicy> = {
  planner: { model: 'opus', effort: 'xhigh' },
  'code-reviewer': { model: 'opus', effort: 'xhigh' },
  'ui-engineer': { model: 'sonnet', effort: 'high' },
  'server-engineer': { model: 'sonnet', effort: 'high' },
  'sync-engineer': { model: 'sonnet', effort: 'high' },
  'test-engineer': { model: 'sonnet', effort: 'high' },
  'ui-reviewer': { model: 'sonnet', effort: 'high' },
  'security-reviewer': { model: 'sonnet', effort: 'high' },
  'ci-fixer': { model: 'sonnet', effort: 'high' },
  'docs-writer': { model: 'sonnet', effort: 'high' },
};

export const MODEL_ALIASES = ['opus', 'sonnet', 'haiku', 'inherit'] as const;
