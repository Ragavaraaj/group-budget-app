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

export const PULL_DEFAULT_LIMIT = 100;
export const PULL_MAX_LIMIT = 200;

/** Group invites expire after a week and can be used a limited number of times. */
export const INVITE_TTL_DAYS = 7;
export const INVITE_MAX_USES = 20;
