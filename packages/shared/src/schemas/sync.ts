import { z } from 'zod';
import { MAX_MUTATIONS_PER_PUSH, PULL_DEFAULT_LIMIT, PULL_MAX_LIMIT } from '../limits';
import {
  budgetDataSchema,
  budgetRowSchema,
  categoryDataSchema,
  categoryRowSchema,
  ENTITY_NAMES,
  expenseDataSchema,
  expenseRowSchema,
  groupRowSchema,
  memberRowSchema,
  recurringDataSchema,
  recurringRowSchema,
  settlementDataSchema,
  settlementRowSchema,
  uuidSchema,
} from './entities';

const mutationBase = {
  /** Unique per change; the server remembers it so a retried push is applied once. */
  mutationId: uuidSchema,
  /** The row version the editor started from; null for a brand-new row. */
  baseVersion: z.number().int().min(0).nullable(),
  createdAt: z.number().int(),
};

/** Create or edit. Last writer wins, except that an edit never revives a deleted row. */
const upsertMutationSchema = z.union([
  z.object({
    ...mutationBase,
    op: z.literal('upsert'),
    entity: z.literal('category'),
    data: categoryDataSchema,
  }),
  z.object({
    ...mutationBase,
    op: z.literal('upsert'),
    entity: z.literal('expense'),
    data: expenseDataSchema,
  }),
  z.object({
    ...mutationBase,
    op: z.literal('upsert'),
    entity: z.literal('settlement'),
    data: settlementDataSchema,
  }),
  z.object({
    ...mutationBase,
    op: z.literal('upsert'),
    entity: z.literal('budget'),
    data: budgetDataSchema,
  }),
  z.object({
    ...mutationBase,
    op: z.literal('upsert'),
    entity: z.literal('recurring'),
    data: recurringDataSchema,
  }),
]);

/** Delete (tombstone) or undo a delete. */
const tombstoneMutationSchema = z.object({
  ...mutationBase,
  op: z.enum(['delete', 'restore']),
  entity: z.enum(ENTITY_NAMES),
  id: uuidSchema,
  groupId: uuidSchema,
});

export const mutationSchema = z.union([upsertMutationSchema, tombstoneMutationSchema]);
export type Mutation = z.infer<typeof mutationSchema>;

export const pushRequestSchema = z.object({
  mutations: z
    .array(mutationSchema)
    .min(1)
    .max(MAX_MUTATIONS_PER_PUSH)
    .refine(
      (mutations) => new Set(mutations.map((m) => m.mutationId)).size === mutations.length,
      'A mutation id appears twice',
    ),
});
export type PushRequest = z.infer<typeof pushRequestSchema>;

export const REJECT_REASONS = [
  'not_a_member',
  'not_found',
  'deleted',
  'group_mismatch',
  'invalid_reference',
  /** The group already has as many budgets or recurring rules as it may. */
  'limit_reached',
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export const mutationResultSchema = z.object({
  mutationId: uuidSchema,
  /** `duplicate` means this exact mutation was already applied earlier. */
  status: z.enum(['applied', 'duplicate', 'rejected']),
  reason: z.enum(REJECT_REASONS).optional(),
  /** The row had changed since the editor loaded it; the edit was still applied. */
  conflict: z.boolean().optional(),
  version: z.number().int().optional(),
});
export type MutationResult = z.infer<typeof mutationResultSchema>;

export const pushResponseSchema = z.object({ results: z.array(mutationResultSchema) });
export type PushResponse = z.infer<typeof pushResponseSchema>;

export const pullQuerySchema = z.object({
  since: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(PULL_MAX_LIMIT).default(PULL_DEFAULT_LIMIT),
});

export const pullResponseSchema = z.object({
  /** Pass this back as `since` next time. */
  cursor: z.number().int().min(0),
  /** True when there is more to fetch right now. */
  hasMore: z.boolean(),
  groups: z.array(groupRowSchema),
  members: z.array(memberRowSchema),
  categories: z.array(categoryRowSchema),
  expenses: z.array(expenseRowSchema),
  settlements: z.array(settlementRowSchema),
  // Added later: a client talking to a server that predates them still parses the page.
  budgets: z.array(budgetRowSchema).default([]),
  recurring: z.array(recurringRowSchema).default([]),
});
export type PullResponse = z.infer<typeof pullResponseSchema>;
