import { z } from 'zod';
import type { Allocation } from '../balances';
import { MAX_PAISE } from '../money';
import { uuidSchema } from './primitives';

/** Who paid, and who owes what: the parts of an expense that must add up. */

/** Zero is allowed for a person who is in a split but owes nothing. */
const allocationAmountSchema = z.number().int().min(0).max(MAX_PAISE);

export const allocationSchema = z.object({
  userId: uuidSchema,
  amountMinor: allocationAmountSchema,
});

export const shareSchema = allocationSchema.extend({
  /** What was entered for percent/shares splits, kept so the split can be edited again. */
  weight: z.number().int().min(1).max(10_000).optional(),
});

const sum = (items: readonly { amountMinor: number }[]) =>
  items.reduce((total, item) => total + item.amountMinor, 0);
const hasDuplicates = (items: readonly { userId: string }[]) =>
  new Set(items.map((item) => item.userId)).size !== items.length;

/** The paise must add up on both sides and nobody may be listed twice. */
export function checkSplit(
  split: {
    amountMinor: number;
    payers: readonly Allocation[];
    shares: readonly Allocation[];
  },
  ctx: z.RefinementCtx,
) {
  if (sum(split.payers) !== split.amountMinor) {
    ctx.addIssue({
      code: 'custom',
      path: ['payers'],
      message: 'Payments must add up to the total',
    });
  }
  if (sum(split.shares) !== split.amountMinor) {
    ctx.addIssue({ code: 'custom', path: ['shares'], message: 'Shares must add up to the total' });
  }
  if (hasDuplicates(split.payers)) {
    ctx.addIssue({ code: 'custom', path: ['payers'], message: 'A person is listed twice' });
  }
  if (hasDuplicates(split.shares)) {
    ctx.addIssue({ code: 'custom', path: ['shares'], message: 'A person is listed twice' });
  }
}
