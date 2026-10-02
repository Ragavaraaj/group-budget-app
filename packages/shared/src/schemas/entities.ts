import { z } from 'zod';
import { isUuid } from '../ids';
import { CATEGORY_NAME_MAX, MAX_GROUP_MEMBERS, NOTE_MAX } from '../limits';
import { MAX_PAISE } from '../money';
import { SPLIT_TYPES } from '../splits';
import { localDateSchema, paiseSchema } from './primitives';

export const uuidSchema = z.string().refine(isUuid, 'Invalid id');

export const ENTITY_NAMES = ['category', 'expense', 'settlement'] as const;
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

/** What a client may send for an expense. The paise must add up on both sides. */
export const expenseDataSchema = expenseBaseSchema.superRefine((expense, ctx) => {
  if (sum(expense.payers) !== expense.amountMinor) {
    ctx.addIssue({
      code: 'custom',
      path: ['payers'],
      message: 'Payments must add up to the total',
    });
  }
  if (sum(expense.shares) !== expense.amountMinor) {
    ctx.addIssue({ code: 'custom', path: ['shares'], message: 'Shares must add up to the total' });
  }
  if (hasDuplicates(expense.payers)) {
    ctx.addIssue({ code: 'custom', path: ['payers'], message: 'A person is listed twice' });
  }
  if (hasDuplicates(expense.shares)) {
    ctx.addIssue({ code: 'custom', path: ['shares'], message: 'A person is listed twice' });
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

// Rows as the server returns them: the data above plus sync metadata (and who created it).
const syncMetaSchema = z.object({
  version: z.number().int().min(1),
  updatedAt: z.number().int(),
  /** Set (epoch ms) when the row was deleted. Deleted rows are kept so deletes sync. */
  deletedAt: z.number().int().nullable(),
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
export type GroupRow = z.infer<typeof groupRowSchema>;
export type MemberRow = z.infer<typeof memberRowSchema>;
