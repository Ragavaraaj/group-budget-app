import type {
  CategoryData,
  CategoryRow,
  EntityName,
  ExpenseData,
  ExpenseRow,
  GroupRow,
  MemberRow,
  SettlementData,
  SettlementRow,
} from '@budget/shared';

// The local database stores rows in the same shape the server sends them. A row that has never
// been to the server has `version: 0` and `serverSeq: 0`.
export type LocalGroup = GroupRow;
export type LocalMember = MemberRow;
export type LocalCategory = CategoryRow;
export type LocalExpense = ExpenseRow;
export type LocalSettlement = SettlementRow;

/** The columns every synced entity has, which is all the sync code needs to know. */
export interface SyncedRow {
  id: string;
  groupId: string;
  version: number;
  updatedAt: number;
  updatedBy: string;
  deletedAt: number | null;
  serverSeq: number;
}

/** A change made on this device that the server hasn't acknowledged yet. */
export interface OutboxEntry {
  /** Auto-increment: the order changes were made, which is the order they are sent. */
  seq?: number;
  mutationId: string;
  entity: EntityName;
  entityId: string;
  /** `${entity}:${entityId}`: finds all pending changes to one row. */
  entityKey: string;
  groupId: string;
  op: 'upsert' | 'delete' | 'restore';
  baseVersion: number | null;
  data?: CategoryData | ExpenseData | SettlementData;
  createdAt: number;
}

/** A change the server refused, kept so the person can see that something didn't sync. */
export interface Rejection {
  at: number;
  entity: EntityName;
  entityId: string;
  op: OutboxEntry['op'];
  reason: string;
  /** True when the change was a new row the server never accepted, so it was removed from this device. */
  discarded?: boolean;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

export const entityKey = (entity: EntityName, id: string) => `${entity}:${id}`;
