import type { PullResponse } from '@budget/shared';

export interface Page<T> {
  rows: T[];
  truncated: boolean;
  /** Highest `server_seq` among the rows we kept. */
  last: number;
}

/** The queries fetch `limit + 1` rows so "exactly limit" and "more to come" can be told apart. */
export function page<T extends { serverSeq: number }>(rows: T[], limit: number): Page<T> {
  const truncated = rows.length > limit;
  const kept = truncated ? rows.slice(0, limit) : rows;
  return { rows: kept, truncated, last: kept.at(-1)?.serverSeq ?? 0 };
}

type Pages = {
  [K in Exclude<keyof PullResponse, 'cursor' | 'hasMore'>]: Page<PullResponse[K][number]>;
};

/**
 * Turns the pages of every table into one response. A truncated table has only been read up to
 * its last row, so the response can only be trusted up to the earliest such point; anything
 * newer is left for the next page.
 */
export function assemble(pages: Pages, since: number): PullResponse {
  const all = Object.values(pages);
  const truncated = all.filter((p) => p.truncated);
  const hasMore = truncated.length > 0;
  const cursor = hasMore
    ? Math.min(...truncated.map((p) => p.last))
    : Math.max(since, ...all.map((p) => p.last));
  const upTo = <T extends { serverSeq: number }>(p: Page<T>) =>
    p.rows.filter((row) => row.serverSeq <= cursor);

  return {
    cursor,
    hasMore,
    groups: upTo(pages.groups),
    members: upTo(pages.members),
    categories: upTo(pages.categories),
    expenses: upTo(pages.expenses),
    settlements: upTo(pages.settlements),
    budgets: upTo(pages.budgets),
    recurring: upTo(pages.recurring),
  };
}
