import { z } from 'zod';
import type { Allocation } from '../balances';
import { isUuid } from '../ids';
import { CATEGORY_NAME_MAX, MAX_GROUP_MEMBERS, NOTE_MAX } from '../limits';
import { MAX_PAISE } from '../money';
import { RECURRENCES } from '../recurring';
import { SPLIT_TYPES } from '../splits';
import { localDateSchema, paiseSchema } from './primitives';

export const uuidSchema = z.string().refine(isUuid, 'Invalid id');

export const ENTITY_NAMES = ['category', 'expense', 'settlement', 'budget', 'recurring'] as const;
export type EntityName = (typeof ENTITY_NAMES)[number];

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

export const categoryDataSchema = z.object({
  id: uuidSchema,
  groupId: uuidSchema,
  name: z.string().trim().min(1).max(CATEGORY_NAME_MAX),
  icon: z.string().min(1).max(32),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a #rrggbb colour'),
  archived: z.boolean(),
});

const expenseBaseSchema = z.object({
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

const sum = (items: readonly { amountMinor: number }[]) =>
  items.reduce((total, item) => total + item.amountMinor, 0);
const hasDuplicates = (items: readonly { userId: string }[]) =>
  new Set(items.map((item) => item.userId)).size !== items.length;

/** The paise must add up on both sides and nobody may be listed twice. */
function checkSplit(
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
const recurringBaseSchema = expenseBaseSchema.omit({ occurredOn: true }).extend({
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

// Rows as the server returns them: the data above plus sync metadata (and who created it).
const syncMetaSchema = z.object({
  version: z.number().int().min(1),
  updatedAt: z.number().int(),
  /** Set (epoch ms) when the row was deleted. Deleted rows are kept so deletes sync. */
  deletedAt: z.number().int().nullable(),
  /** Who made the latest change; the activity feed is built from this. */
  updatedBy: uuidSchema,
  serverSeq: z.number().int().min(1),
});

export const categoryRowSchema = categoryDataSchema.extend(syncMetaSchema.shape);
export const expenseRowSchema = expenseBaseSchema.extend({
  createdBy: uuidSchema,
  ...syncMetaSchema.shape,
});
export const settlementRowSchema = z.object({
  id: uuidSchema,
  groupId: uuidSchema,
  fromUser: uuidSchema,
  toUser: uuidSchema,
  amountMinor: paiseSchema,
  occurredOn: localDateSchema,
  note: z.string(),
  createdBy: uuidSchema,
  ...syncMetaSchema.shape,
});

export const budgetRowSchema = budgetDataSchema.extend(syncMetaSchema.shape);
export const recurringRowSchema = recurringBaseSchema.extend({
  createdBy: uuidSchema,
  /** The last occurrence the server turned into an expense. */
  lastGeneratedOn: localDateSchema.nullable(),
  ...syncMetaSchema.shape,
});

export const groupRowSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  isPersonal: z.boolean(),
  createdBy: uuidSchema,
  createdAt: z.number().int(),
  version: z.number().int().min(1),
  serverSeq: z.number().int().min(1),
});

export const memberRowSchema = z.object({
  groupId: uuidSchema,
  userId: uuidSchema,
  role: z.enum(['owner', 'member']),
  joinedAt: z.number().int(),
  /** Set when the person left or was removed. */
  removedAt: z.number().int().nullable(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  serverSeq: z.number().int().min(1),
});

export type CategoryRow = z.infer<typeof categoryRowSchema>;
export type ExpenseRow = z.infer<typeof expenseRowSchema>;
export type SettlementRow = z.infer<typeof settlementRowSchema>;
export type BudgetRow = z.infer<typeof budgetRowSchema>;
export type RecurringRow = z.infer<typeof recurringRowSchema>;
export type GroupRow = z.infer<typeof groupRowSchema>;
export type MemberRow = z.infer<typeof memberRowSchema>;
