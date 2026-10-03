import { allocateByWeights } from './allocate';
import {
  BASIS_POINTS_TOTAL,
  type SplitParticipant,
  type SplitResult,
  type SplitType,
} from './split-types';

/**
 * Turning "who shares this expense and how" into exact paise per person. Whatever the split
 * type, the shares always add up to the total to the paisa (see `allocateByWeights`).
 */

export * from './split-types';
export { allocateByWeights };

const isPositiveInt = (value: number | undefined): value is number =>
  value !== undefined && Number.isSafeInteger(value) && value > 0;
const isPaise = (value: number | undefined): value is number =>
  value !== undefined && Number.isSafeInteger(value) && value >= 0;
const total = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0);

/** Shares by weight (percent or shares), each keeping the weight it was given. */
function byWeight(totalMinor: number, participants: readonly SplitParticipant[]): SplitResult {
  const weights = participants.map((p) => p.value);
  if (!weights.every(isPositiveInt)) return { ok: false, error: 'invalid_value' };
  const amounts = allocateByWeights(totalMinor, weights);
  const shares = participants.map((p, i) => ({
    userId: p.userId,
    amountMinor: amounts[i] ?? 0,
    weight: p.value,
  }));
  return { ok: true, shares };
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
  const values = participants.map((p) => p.value);

  switch (type) {
    case 'equal': {
      const amounts = allocateByWeights(
        totalMinor,
        participants.map(() => 1),
      );
      const shares = participants.map((p, i) => ({
        userId: p.userId,
        amountMinor: amounts[i] ?? 0,
      }));
      return { ok: true, shares };
    }
    case 'shares':
      return byWeight(totalMinor, participants);
    case 'percent':
      if (values.every(isPositiveInt) && total(values) !== BASIS_POINTS_TOTAL) {
        return { ok: false, error: 'sum_mismatch' };
      }
      return byWeight(totalMinor, participants);
    case 'exact': {
      if (!values.every(isPaise)) return { ok: false, error: 'invalid_value' };
      if (total(values) !== totalMinor) return { ok: false, error: 'sum_mismatch' };
      const shares = participants.map((p, i) => ({
        userId: p.userId,
        amountMinor: values[i] ?? 0,
      }));
      return { ok: true, shares };
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
