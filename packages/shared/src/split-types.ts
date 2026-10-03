/** The shapes a split is described in; `splits.ts` turns them into exact paise. */

export const SPLIT_TYPES = ['equal', 'exact', 'percent', 'shares'] as const;
export type SplitType = (typeof SPLIT_TYPES)[number];

/** Percent splits use basis points (1% = 100) so that fractions like 33.33% stay integers. */
export const BASIS_POINTS_TOTAL = 10_000;

export interface SplitParticipant {
  userId: string;
  /**
   * What the person entered, by split type: nothing for `equal`; paise for `exact`;
   * basis points for `percent`; a positive whole number of shares for `shares`.
   */
  value?: number;
}

export interface Share {
  userId: string;
  amountMinor: number;
  /** The entered value, kept so the split can be shown and edited again later. */
  weight?: number;
}

export type SplitError =
  | 'no_participants'
  | 'duplicate_participant'
  | 'invalid_total'
  | 'invalid_value'
  | 'sum_mismatch';

export type SplitResult = { ok: true; shares: Share[] } | { ok: false; error: SplitError };
