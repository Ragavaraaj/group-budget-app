import { z } from 'zod';
import { PULL_DEFAULT_LIMIT, PULL_MAX_LIMIT } from '../limits';
import {
  budgetRowSchema,
  categoryRowSchema,
  expenseRowSchema,
  groupRowSchema,
  memberRowSchema,
  recurringRowSchema,
  settlementRowSchema,
} from './rows';

/** The pull side of sync. What a device pushes is in `mutations.ts`. */

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
