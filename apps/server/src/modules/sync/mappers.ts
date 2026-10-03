import type { CategoryRow, ExpenseRow, GroupRow, MemberRow, SettlementRow } from '@budget/shared';
import type { categories, expenses, groups, settlements } from '../../db/schema';

// Database rows to the shapes the API returns (and the clients store). Columns are copied one by
// one so a server-only column (such as a rule's `nextDueOn`) never reaches a client.

/** The sync metadata every synced row carries, copied column by column like the rest. */
export const syncMeta = (r: SyncMeta) => ({
  version: r.version,
  updatedAt: r.updatedAt,
  updatedBy: r.updatedBy,
  deletedAt: r.deletedAt,
  serverSeq: r.serverSeq,
});

type SyncMeta = Pick<
  typeof categories.$inferSelect,
  'version' | 'updatedAt' | 'updatedBy' | 'deletedAt' | 'serverSeq'
>;

export const toCategoryRow = (r: typeof categories.$inferSelect): CategoryRow => ({
  id: r.id,
  groupId: r.groupId,
  name: r.name,
  icon: r.icon,
  color: r.color,
  archived: r.archived,
  ...syncMeta(r),
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
  ...syncMeta(r),
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
  ...syncMeta(r),
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
