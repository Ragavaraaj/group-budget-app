/**
 * The plan lives in the issue body, between two markers, and nowhere else: not in a file, not in an
 * artifact. Whatever the person wrote above the markers is kept as it is.
 */

export const PLAN_START = '<!-- sdlc:plan:start -->';
export const PLAN_END = '<!-- sdlc:plan:end -->';

export const CHANGE_TYPES = ['feat', 'fix', 'test', 'chore'] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

/** What the plan stage returns as structured output (schema: `schemas/plan.json`). */
export interface PlanOutput {
  plan_markdown: string;
  type: ChangeType;
  size: 'S' | 'M' | 'L';
  risk: 'low' | 'medium' | 'high';
  questions: string[];
  context: {
    areas: string[];
    files: string[];
    tests: string[];
    graph_notes: string;
  };
}

export function hasPlan(body: string | null | undefined): boolean {
  return extractPlan(body) !== null;
}

/** The plan's text, or null when the issue has none yet. */
export function extractPlan(body: string | null | undefined): string | null {
  if (!body) return null;
  const start = body.indexOf(PLAN_START);
  const end = body.indexOf(PLAN_END);
  if (start === -1 || end === -1 || end < start) return null;
  const text = body.slice(start + PLAN_START.length, end).trim();
  return text === '' ? null : text;
}

/** Puts the plan into the body, replacing an earlier one and keeping the person's own text. */
export function upsertPlan(body: string | null | undefined, plan: string): string {
  const section = `${PLAN_START}\n${plan.trim()}\n${PLAN_END}`;
  const current = body ?? '';
  const start = current.indexOf(PLAN_START);
  const end = current.indexOf(PLAN_END);
  if (start !== -1 && end > start) {
    return `${current.slice(0, start)}${section}${current.slice(end + PLAN_END.length)}`;
  }
  const own = current.trimEnd();
  return own === '' ? section : `${own}\n\n${section}`;
}

/** The block written above the plan itself: what the person is approving besides the steps. */
export function planHeader(input: {
  branch: string;
  size: string;
  risk: string;
  runUrl: string | null;
}): string {
  const run = input.runUrl ? ` · [planning run](${input.runUrl})` : '';
  return [
    '## Plan',
    '',
    `**Branch:** \`${input.branch}\` · **Size:** ${input.size} · **Risk:** ${input.risk}${run}`,
    '',
    '_Edit this section freely; the pipeline builds what it says. Comment `/approve` (or drag the card to In Progress) to start, or comment with changes and `/replan`._',
  ].join('\n');
}

/** Checks the structured output's shape; the schema should already guarantee it. */
export function parsePlanOutput(raw: string): PlanOutput {
  const value = JSON.parse(raw) as Partial<PlanOutput>;
  const problems: string[] = [];
  if (typeof value.plan_markdown !== 'string' || value.plan_markdown.trim() === '') {
    problems.push('plan_markdown is empty');
  }
  if (!CHANGE_TYPES.includes(value.type as ChangeType))
    problems.push('type is not one of feat|fix|test|chore');
  if (!['S', 'M', 'L'].includes(value.size as string)) problems.push('size is not S|M|L');
  if (!['low', 'medium', 'high'].includes(value.risk as string))
    problems.push('risk is not low|medium|high');
  if (!Array.isArray(value.questions)) problems.push('questions is not a list');
  if (!value.context || !Array.isArray(value.context.areas))
    problems.push('context.areas is missing');
  if (problems.length > 0) throw new Error(`The plan output is not usable: ${problems.join('; ')}`);
  return value as PlanOutput;
}
