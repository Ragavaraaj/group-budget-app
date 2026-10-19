/**
 * The vocabulary shared by every part of the pipeline: the board's columns, the "AI stage" field's
 * options, and the work a card can be waiting for. Names on the board are matched loosely (see
 * `sameName`), so a column called "In progress" or "in-progress" still counts as In Progress.
 */

export const STATUS = {
  todo: 'Todo',
  inProgress: 'In Progress',
  inReview: 'In Review',
  blocked: 'Blocked',
  done: 'Done',
} as const;
export type StatusKey = keyof typeof STATUS;

/** Options of the "AI stage" single-select field, in board order. */
export const STAGES = {
  queued: 'Queued',
  planning: 'Planning',
  needs_input: 'Needs input',
  awaiting_approval: 'Awaiting plan approval',
  implementing: 'Implementing',
  ci_running: 'CI running',
  fixing_ci: 'Fixing CI',
  ai_review: 'AI review',
  addressing_review: 'Addressing review',
  resolving_conflict: 'Resolving conflict',
  awaiting_your_approval: 'Awaiting your approval',
  merging: 'Merging',
  merged: 'Merged',
  deployed: 'Deployed',
  deploy_failed: 'Deploy failed',
  paused: 'Paused (usage limit)',
  blocked: 'Blocked',
} as const;
export type StageKey = keyof typeof STAGES;

/** Colours for the AI stage options when `doctor` creates the field. */
export const STAGE_COLORS: Record<StageKey, string> = {
  queued: 'GRAY',
  planning: 'BLUE',
  needs_input: 'YELLOW',
  awaiting_approval: 'YELLOW',
  implementing: 'BLUE',
  ci_running: 'BLUE',
  fixing_ci: 'ORANGE',
  ai_review: 'PURPLE',
  addressing_review: 'ORANGE',
  resolving_conflict: 'ORANGE',
  awaiting_your_approval: 'YELLOW',
  merging: 'GREEN',
  merged: 'GREEN',
  deployed: 'GREEN',
  deploy_failed: 'RED',
  paused: 'GRAY',
  blocked: 'RED',
};

export const FIELD_STAGE = 'AI stage';
export const FIELD_NOTE = 'AI note';

/** The four stages that run Claude. Each has its own workflow. */
export type WorkKind = 'plan' | 'implement' | 'review' | 'fix';
export type FixReason = 'ci' | 'review' | 'conflict';

/** A piece of work a card is waiting to run, after a pause or while others hold the slots. */
export interface PendingWork {
  kind: WorkKind;
  reason?: FixReason;
  pr?: number;
  /** The failed CI run a `fix` for `ci` reads its artifacts from. */
  failedRunId?: number;
  /** Plan, then go straight on to implementing (the card was put in In Progress unplanned). */
  autoImplement?: boolean;
}

export const WORKFLOWS: Record<WorkKind, string> = {
  plan: 'sdlc-plan.yml',
  implement: 'sdlc-implement.yml',
  review: 'sdlc-review.yml',
  fix: 'sdlc-fix.yml',
};

/** Workflow files whose runs call Claude, counted against `SDLC_MAX_PARALLEL`. */
export const CLAUDE_WORKFLOWS = Object.values(WORKFLOWS);

export const LABELS = {
  sdlc: { name: 'sdlc', color: '5319e7', description: 'Managed by the AI SDLC pipeline' },
  blocked: { name: 'sdlc:blocked', color: 'b60205', description: 'The pipeline needs a person' },
  control: { name: 'sdlc:control', color: '0e8a16', description: 'The AI SDLC control issue' },
  bug: { name: 'bug', color: 'd73a4a', description: 'Something is not working' },
  observation: {
    name: 'observation',
    color: 'c5def5',
    description: 'Looks odd, works as intended',
  },
  severityHigh: {
    name: 'severity:high',
    color: 'b60205',
    description: 'Loses or corrupts data, or blocks sign-in',
  },
  severityMedium: {
    name: 'severity:medium',
    color: 'fbca04',
    description: 'Blocks a flow, or wrong on a main screen for everyone',
  },
  severityLow: {
    name: 'severity:low',
    color: 'c2e0c6',
    description: 'Unusual input, wording or consistency',
  },
} as const;

/** `area:*` labels, one per feature folder and server module. */
export const AREAS = [
  'auth',
  'budgets',
  'categories',
  'expenses',
  'groups',
  'import',
  'insights',
  'recurring',
  'search',
  'settings',
  'sync',
  'layout',
  'design-system',
  'pwa',
  'live',
  'ci',
] as const;

/** How many fix and review rounds a card gets before it moves to Blocked. */
export const CAPS = { ciFixes: 3, reviewRounds: 3, flakyReruns: 1 } as const;

/** A stage that has said nothing for this long is treated as stuck. */
export const STALE_AFTER_MS = 90 * 60 * 1000;

export const TRUSTED_ASSOCIATIONS = ['OWNER', 'MEMBER', 'COLLABORATOR'] as const;

/** Loose name match for board columns and field options: case, spaces, dashes and underscores. */
export function sameName(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '');
  return norm(a) === norm(b);
}

export function statusKeyOf(name: string | null | undefined): StatusKey | null {
  if (!name) return null;
  for (const [key, label] of Object.entries(STATUS)) {
    if (sameName(label, name)) return key as StatusKey;
  }
  return null;
}

export function stageKeyOf(name: string | null | undefined): StageKey | null {
  if (!name) return null;
  for (const [key, label] of Object.entries(STAGES)) {
    if (sameName(label, name)) return key as StageKey;
  }
  return null;
}
