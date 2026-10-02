import type {
  BudgetRow,
  CategoryRow,
  ExpenseRow,
  GroupRow,
  MemberRow,
  RecurringRow,
  SettlementRow,
} from '@budget/shared';
import type {
  budgets,
  categories,
  expenses,
  groups,
  recurringRules,
  settlements,
} from '../../db/schema';

// Database rows to the shapes the API returns (and the clients store).

export const toCategoryRow = (r: typeof categories.$inferSelect): CategoryRow => ({
  id: r.id,
  groupId: r.groupId,
  name: r.name,
  icon: r.icon,
  color: r.color,
  archived: r.archived,
  version: r.version,
  updatedAt: r.updatedAt,
  updatedBy: r.updatedBy,
  deletedAt: r.deletedAt,
  serverSeq: r.serverSeq,
});

export const toExpenseRow = (r: typeof expenses.$inferSelect): ExpenseRow => ({
  id: r.id,
  groupId: r.groupId,
  occurredOn: r.occurredOn,
  amountMinor: r.amountMinor,
  categoryId: r.categoryId,
  note: r.note,
  splitType: r.splitType,
  payers: r.payers,
  shares: r.shares,
  createdBy: r.createdBy,
  version: r.version,
  updatedAt: r.updatedAt,
  updatedBy: r.updatedBy,
  deletedAt: r.deletedAt,
  serverSeq: r.serverSeq,
});

export const toSettlementRow = (r: typeof settlements.$inferSelect): SettlementRow => ({
  id: r.id,
  groupId: r.groupId,
  fromUser: r.fromUser,
  toUser: r.toUser,
  amountMinor: r.amountMinor,
  occurredOn: r.occurredOn,
  note: r.note,
  createdBy: r.createdBy,
  version: r.version,
  updatedAt: r.updatedAt,
  updatedBy: r.updatedBy,
  deletedAt: r.deletedAt,
  serverSeq: r.serverSeq,
});

export const toBudgetRow = (r: typeof budgets.$inferSelect): BudgetRow => ({
  id: r.id,
  groupId: r.groupId,
  categoryId: r.categoryId,
  amountMinor: r.amountMinor,
  version: r.version,
  updatedAt: r.updatedAt,
  updatedBy: r.updatedBy,
  deletedAt: r.deletedAt,
  serverSeq: r.serverSeq,
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
  version: r.version,
  updatedAt: r.updatedAt,
  updatedBy: r.updatedBy,
  deletedAt: r.deletedAt,
  serverSeq: r.serverSeq,
});

export const toGroupRow = (r: typeof groups.$inferSelect): GroupRow => ({
  id: r.id,
  name: r.name,
  isPersonal: r.isPersonal,
  createdBy: r.createdBy,
  createdAt: r.createdAt,
  version: r.version,
  serverSeq: r.serverSeq,
});

export interface MemberJoinRow {
  groupId: string;
  userId: string;
  role: 'owner' | 'member';
  joinedAt: number;
  removedAt: number | null;
  serverSeq: number;
  displayName: string;
  avatarUrl: string | null;
  isPlaceholder: boolean;
}

export const toMemberRow = (r: MemberJoinRow): MemberRow => ({ ...r });
