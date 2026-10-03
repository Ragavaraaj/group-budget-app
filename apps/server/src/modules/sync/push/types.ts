import type { EntityName, Mutation, MutationResult } from '@budget/shared';
import type { BatchItem } from 'drizzle-orm/batch';

export type Statement = BatchItem<'sqlite'>;
export type Upsert = Extract<Mutation, { op: 'upsert' }>;
export type Tombstone = Extract<Mutation, { op: 'delete' | 'restore' }>;

/** What we know about a row: from the database, or from an earlier mutation in the same push. */
export interface Known {
  groupId: string;
  version: number;
  deletedAt: number | null;
  /** The row as the API shows it, for the audit log. */
  snapshot: unknown;
}

/** Where a recurring rule stands in its schedule. The scheduled job moves it on from there. */
export interface Schedule {
  lastGeneratedOn: string | null;
  nextDueOn: string | null;
}

/** What the server itself decides about a recurring rule (see `recurringServerFields`). */
export interface RecurringServer extends Schedule {
  createdBy: string;
  /** A paused rule was switched on again in this edit. */
  resumed: boolean;
  /** The creator had left the group, so this edit made the editor answerable for the rule. */
  tookOver: boolean;
}

export interface UpsertWrite {
  kind: 'upsert';
  mutation: Upsert;
  version: number;
  before: unknown;
  after: unknown;
  server?: RecurringServer;
}

export interface TombstoneWrite {
  kind: 'delete' | 'restore';
  mutation: Tombstone;
  before: unknown;
  after: unknown;
  /** A recurring rule's schedule after the change (see `recurringTombstoneSchedule`). */
  schedule?: Schedule;
}

export type Write = UpsertWrite | TombstoneWrite;

export interface Plan {
  results: MutationResult[];
  writes: Write[];
  /** Mutations that are valid but change nothing (delete of a deleted row): still recorded. */
  noops: Mutation[];
  /** The people in the groups being written to, who should be told about it. */
  recipients: string[];
}

/** The people of each group: everyone who ever belonged, and those who belong now. */
export interface Members {
  ever: Map<string, Set<string>>;
  active: Map<string, Set<string>>;
}

export const entityIdOf = (m: Mutation) => (m.op === 'upsert' ? m.data.id : m.id);
export const groupIdOf = (m: Mutation) => (m.op === 'upsert' ? m.data.groupId : m.groupId);
export const key = (entity: EntityName, id: string) => `${entity}:${id}`;
export const unique = <T>(items: T[]) => [...new Set(items)];
