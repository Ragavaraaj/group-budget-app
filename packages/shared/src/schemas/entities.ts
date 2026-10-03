import { z } from 'zod';
import { CATEGORY_NAME_MAX, MAX_GROUP_MEMBERS, NOTE_MAX } from '../limits';
import { RECURRENCES } from '../recurring';
import { SPLIT_TYPES } from '../splits';
import { localDateSchema, paiseSchema, uuidSchema } from './primitives';
import { allocationSchema, checkSplit, shareSchema } from './split';

/** What a client may send for each synced entity. The rows the server returns are in `rows.ts`. */

export const ENTITY_NAMES = ['category', 'expense', 'settlement', 'budget', 'recurring'] as const;
export type EntityName = (typeof ENTITY_NAMES)[number];

export const categoryDataSchema = z.object({
  id: uuidSchema,
  groupId: uuidSchema,
  name: z.string().trim().min(1).max(CATEGORY_NAME_MAX),
  icon: z.string().min(1).max(32),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a #rrggbb colour'),
  archived: z.boolean(),
});

/** An expense before the "does it add up" check; the row schema builds on it too. */
export const expenseBaseSchema = z.object({
  id: uuidSchema,
  groupId: uuidSchema,
  occurredOn: localDateSchema,
  amountMinor: paiseSchema,
  categoryId: uuidSchema.nullable(),
  note: z.string().trim().max(NOTE_MAX),
  splitType: z.enum(SPLIT_TYPES),
  payers: z.array(allocationSchema).min(1).max(MAX_GROUP_MEMBERS),
  shares: z.array(shareSchema).min(1).max(MAX_GROUP_MEMBERS),
});

/** What a client may send for an expense. The paise must add up on both sides. */
export const expenseDataSchema = expenseBaseSchema.superRefine(checkSplit);

/** A monthly spending limit: one for the whole group (`categoryId: null`) or one per category. */
export const budgetDataSchema = z.object({
  id: uuidSchema,
  groupId: uuidSchema,
  categoryId: uuidSchema.nullable(),
  amountMinor: paiseSchema,
});

/**
 * An expense that repeats. It carries the same split an expense does, plus when to repeat.
 * Which occurrences have been created already is the server's to track, not the client's.
 */
export const recurringBaseSchema = expenseBaseSchema.omit({ occurredOn: true }).extend({
  frequency: z.enum(RECURRENCES),
  /** The first occurrence; it also fixes the weekday, day of the month or day of the year. */
  startOn: localDateSchema,
  /** No occurrences after this date; `null` repeats for ever. */
  endOn: localDateSchema.nullable(),
  /** Paused rules create nothing. */
  active: z.boolean(),
});

export const recurringDataSchema = recurringBaseSchema.superRefine((rule, ctx) => {
  checkSplit(rule, ctx);
  if (rule.endOn !== null && rule.endOn < rule.startOn) {
    ctx.addIssue({ code: 'custom', path: ['endOn'], message: 'Cannot end before it starts' });
  }
});

export const settlementDataSchema = z
  .object({
    id: uuidSchema,
    groupId: uuidSchema,
    fromUser: uuidSchema,
    toUser: uuidSchema,
    amountMinor: paiseSchema,
    occurredOn: localDateSchema,
    note: z.string().trim().max(NOTE_MAX),
  })
  .refine((settlement) => settlement.fromUser !== settlement.toUser, {
    path: ['toUser'],
    message: 'Cannot settle with yourself',
  });

export type CategoryData = z.infer<typeof categoryDataSchema>;
export type ExpenseData = z.infer<typeof expenseDataSchema>;
export type SettlementData = z.infer<typeof settlementDataSchema>;
export type BudgetData = z.infer<typeof budgetDataSchema>;
export type RecurringData = z.infer<typeof recurringDataSchema>;
