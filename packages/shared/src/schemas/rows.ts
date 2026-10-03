import { z } from 'zod';
import {
  budgetDataSchema,
  categoryDataSchema,
  expenseBaseSchema,
  recurringBaseSchema,
} from './entities';
import { localDateSchema, paiseSchema, uuidSchema } from './primitives';

// Rows as the server returns them: the data a client sends plus sync metadata (and who created it).
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
  /** Someone the owner added by name who doesn't use the app (they can't sign in). */
  isPlaceholder: z.boolean().default(false),
  serverSeq: z.number().int().min(1),
});

export type CategoryRow = z.infer<typeof categoryRowSchema>;
export type ExpenseRow = z.infer<typeof expenseRowSchema>;
export type SettlementRow = z.infer<typeof settlementRowSchema>;
export type BudgetRow = z.infer<typeof budgetRowSchema>;
export type RecurringRow = z.infer<typeof recurringRowSchema>;
export type GroupRow = z.infer<typeof groupRowSchema>;
export type MemberRow = z.infer<typeof memberRowSchema>;
