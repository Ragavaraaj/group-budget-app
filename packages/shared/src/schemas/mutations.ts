import { z } from 'zod';
import { MAX_MUTATIONS_PER_PUSH } from '../limits';
import {
  budgetDataSchema,
  categoryDataSchema,
  ENTITY_NAMES,
  type EntityName,
  expenseDataSchema,
  recurringDataSchema,
  settlementDataSchema,
} from './entities';
import { uuidSchema } from './primitives';

const mutationBase = {
  /** Unique per change; the server remembers it so a retried push is applied once. */
  mutationId: uuidSchema,
  /** The row version the editor started from; null for a brand-new row. */
  baseVersion: z.number().int().min(0).nullable(),
  createdAt: z.number().int(),
};

const upsertOf = <E extends EntityName, D extends z.ZodType>(entity: E, data: D) =>
  z.object({ ...mutationBase, op: z.literal('upsert'), entity: z.literal(entity), data });

/** Create or edit. Last writer wins, except that an edit never revives a deleted row. */
const upsertMutationSchema = z.union([
  upsertOf('category', categoryDataSchema),
  upsertOf('expense', expenseDataSchema),
  upsertOf('settlement', settlementDataSchema),
  upsertOf('budget', budgetDataSchema),
  upsertOf('recurring', recurringDataSchema),
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
