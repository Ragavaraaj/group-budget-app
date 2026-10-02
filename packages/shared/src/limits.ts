/** Limits shared by the client (to validate early) and the server (to enforce). */

export const GROUP_NAME_MAX = 60;
export const CATEGORY_NAME_MAX = 40;
export const NOTE_MAX = 200;
export const DISPLAY_NAME_MAX = 100;

/** Participants in one expense, and members in one group. D1 also caps bound parameters at 100. */
export const MAX_GROUP_MEMBERS = 50;
export const MAX_GROUPS_PER_USER = 30;

/**
 * Mutations accepted in one push. The Workers free plan allows 50 D1 queries per invocation, and
 * a push issues about three statements per mutation plus a handful of reads, so 10 stays inside.
 */
export const MAX_MUTATIONS_PER_PUSH = 10;

/** Budgets (one overall, one per category) and recurring rules a group can hold. */
export const MAX_BUDGETS_PER_GROUP = 60;
export const MAX_RECURRING_PER_GROUP = 50;

/**
 * Expenses the scheduled job creates in one run. A run is one Worker invocation, so the free
 * plan's 50 D1 queries apply: each occurrence takes four statements, plus one read to find them.
 * The job runs every hour, so a backlog clears within hours.
 */
export const RECURRING_MAX_PER_RUN = 10;

/**
 * A new or resumed recurring rule never creates expenses for dates further back than this, so
 * a mistyped start date can't flood a group with old expenses.
 */
export const RECURRING_MAX_BACKFILL_DAYS = 93;

/** Rows accepted in one CSV import (it becomes that many expenses to sync). */
export const MAX_IMPORT_ROWS = 500;

export const PULL_DEFAULT_LIMIT = 100;
export const PULL_MAX_LIMIT = 200;

/** Group invites expire after a week and can be used a limited number of times. */
export const INVITE_TTL_DAYS = 7;
export const INVITE_MAX_USES = 20;
