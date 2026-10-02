/**
 * Turning "who shares this expense and how" into exact paise per person.
 *
 * Whatever the split type, the shares always add up to the total to the paisa. Fractions are
 * resolved with the largest-remainder method: everyone gets the floor of their exact share, and
 * the leftover paise go to the people whose exact share had the largest fractional part
 * (ties go to whoever comes first in the list). All arithmetic is on integers.
 */

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

/** Splits `totalMinor` by integer weights using the largest-remainder method. */
export function allocateByWeights(totalMinor: number, weights: readonly number[]): number[] {
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  if (weights.length === 0 || weightSum <= 0) return weights.map(() => 0);

  const exact = weights.map((weight) => {
    const product = totalMinor * weight;
    return { floor: Math.floor(product / weightSum), remainder: product % weightSum };
  });
  const amounts = exact.map((entry) => entry.floor);

  let leftover = totalMinor - amounts.reduce((sum, amount) => sum + amount, 0);
  const order = exact
    .map((entry, index) => ({ index, remainder: entry.remainder }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of order) {
    if (leftover <= 0) break;
    amounts[index] = (amounts[index] ?? 0) + 1;
    leftover -= 1;
  }
  return amounts;
}

function isPositiveInt(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0;
}

export function computeShares(
  type: SplitType,
  totalMinor: number,
  participants: readonly SplitParticipant[],
): SplitResult {
  if (!Number.isSafeInteger(totalMinor) || totalMinor <= 0) {
    return { ok: false, error: 'invalid_total' };
  }
  if (participants.length === 0) return { ok: false, error: 'no_participants' };
  if (new Set(participants.map((p) => p.userId)).size !== participants.length) {
    return { ok: false, error: 'duplicate_participant' };
  }

  switch (type) {
    case 'equal': {
      const amounts = allocateByWeights(
        totalMinor,
        participants.map(() => 1),
      );
      return {
        ok: true,
        shares: participants.map((p, i) => ({ userId: p.userId, amountMinor: amounts[i] ?? 0 })),
      };
    }

    case 'shares': {
      const weights = participants.map((p) => p.value);
      if (!weights.every(isPositiveInt)) return { ok: false, error: 'invalid_value' };
      const amounts = allocateByWeights(totalMinor, weights);
      return {
        ok: true,
        shares: participants.map((p, i) => ({
          userId: p.userId,
          amountMinor: amounts[i] ?? 0,
          weight: p.value,
        })),
      };
    }

    case 'percent': {
      const weights = participants.map((p) => p.value);
      if (!weights.every(isPositiveInt)) return { ok: false, error: 'invalid_value' };
      if (weights.reduce((sum, weight) => sum + weight, 0) !== BASIS_POINTS_TOTAL) {
        return { ok: false, error: 'sum_mismatch' };
      }
      const amounts = allocateByWeights(totalMinor, weights);
      return {
        ok: true,
        shares: participants.map((p, i) => ({
          userId: p.userId,
          amountMinor: amounts[i] ?? 0,
          weight: p.value,
        })),
      };
    }

    case 'exact': {
      const values = participants.map((p) => p.value);
      if (!values.every((v): v is number => v !== undefined && Number.isSafeInteger(v) && v >= 0)) {
        return { ok: false, error: 'invalid_value' };
      }
      if (values.reduce((sum, value) => sum + value, 0) !== totalMinor) {
        return { ok: false, error: 'sum_mismatch' };
      }
      return {
        ok: true,
        shares: participants.map((p, i) => ({ userId: p.userId, amountMinor: values[i] ?? 0 })),
      };
    }
  }
}

/** How far the entered values are from adding up, for live feedback ("₹40 left to assign"). */
export function splitRemainder(
  type: SplitType,
  totalMinor: number,
  participants: readonly SplitParticipant[],
): number {
  const sum = participants.reduce((acc, p) => acc + (p.value ?? 0), 0);
  if (type === 'exact') return totalMinor - sum;
  if (type === 'percent') return BASIS_POINTS_TOTAL - sum;
  return 0;
}
