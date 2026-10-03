import type { BudgetRow, RecurringRow } from '@budget/shared';
import type { budgets, recurringRules } from '../../db/schema';
import { syncMeta } from './mappers';

// Budgets and recurring rules as the API returns them (see `mappers.ts`).

export const toBudgetRow = (r: typeof budgets.$inferSelect): BudgetRow => ({
  id: r.id,
  groupId: r.groupId,
  categoryId: r.categoryId,
  amountMinor: r.amountMinor,
  ...syncMeta(r),
});

export const toRecurringRow = (r: typeof recurringRules.$inferSelect): RecurringRow => ({
  id: r.id,
  groupId: r.groupId,
  frequency: r.frequency,
  startOn: r.startOn,
  endOn: r.endOn,
  active: r.active,
  amountMinor: r.amountMinor,
  categoryId: r.categoryId,
  note: r.note,
  splitType: r.splitType,
  payers: r.payers,
  shares: r.shares,
  createdBy: r.createdBy,
  lastGeneratedOn: r.lastGeneratedOn,
  ...syncMeta(r),
});
