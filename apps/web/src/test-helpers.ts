import {
  type BudgetRow,
  type CategoryRow,
  type ExpenseRow,
  type GroupRow,
  type MemberRow,
  type Mutation,
  type MutationResult,
  type PullResponse,
  type RecurringRow,
  uuidv7,
} from '@budget/shared';
import { ApiError } from '@/lib/api';
import type { PullQuery, SyncApi } from '@/sync/api';

export const emptyPull = (overrides: Partial<PullResponse> = {}): PullResponse => ({
  cursor: 0,
  hasMore: false,
  groups: [],
  members: [],
  categories: [],
  expenses: [],
  settlements: [],
  budgets: [],
  recurring: [],
  ...overrides,
});

export const groupRow = (
  id: string,
  createdBy: string,
  overrides: Partial<GroupRow> = {},
): GroupRow => ({
  id,
  name: 'Group',
  isPersonal: false,
  createdBy,
  createdAt: 1,
  version: 1,
  serverSeq: 1,
  ...overrides,
});

export const memberRow = (
  groupId: string,
  userId: string,
  overrides: Partial<MemberRow> = {},
): MemberRow => ({
  groupId,
  userId,
  role: 'member',
  joinedAt: 1,
  removedAt: null,
  displayName: 'Someone',
  avatarUrl: null,
  serverSeq: 1,
  ...overrides,
});

export const expenseRow = (
  groupId: string,
  userId: string,
  overrides: Partial<ExpenseRow> = {},
): ExpenseRow => ({
  id: uuidv7(),
  groupId,
  occurredOn: '2026-10-02',
  amountMinor: 1_000,
  categoryId: null,
  note: '',
  splitType: 'equal',
  payers: [{ userId, amountMinor: 1_000 }],
  shares: [{ userId, amountMinor: 1_000 }],
  createdBy: userId,
  version: 1,
  updatedAt: 1,
  updatedBy: userId,
  deletedAt: null,
  serverSeq: 1,
  ...overrides,
});

export const categoryRow = (
  groupId: string,
  userId: string,
  overrides: Partial<CategoryRow> = {},
): CategoryRow => ({
  id: uuidv7(),
  groupId,
  name: 'Food',
  icon: 'utensils',
  color: '#ff0000',
  archived: false,
  version: 1,
  updatedAt: 1,
  updatedBy: userId,
  deletedAt: null,
  serverSeq: 1,
  ...overrides,
});

export const budgetRow = (
  groupId: string,
  userId: string,
  overrides: Partial<BudgetRow> = {},
): BudgetRow => ({
  id: uuidv7(),
  groupId,
  categoryId: null,
  amountMinor: 500_000,
  version: 1,
  updatedAt: 1,
  updatedBy: userId,
  deletedAt: null,
  serverSeq: 1,
  ...overrides,
});

export const recurringRow = (
  groupId: string,
  userId: string,
  overrides: Partial<RecurringRow> = {},
): RecurringRow => ({
  id: uuidv7(),
  groupId,
  frequency: 'monthly',
  startOn: '2026-11-01',
  endOn: null,
  active: true,
  amountMinor: 1_000,
  categoryId: null,
  note: 'Rent',
  splitType: 'equal',
  payers: [{ userId, amountMinor: 1_000 }],
  shares: [{ userId, amountMinor: 1_000 }],
  createdBy: userId,
  lastGeneratedOn: null,
  version: 1,
  updatedAt: 1,
  updatedBy: userId,
  deletedAt: null,
  serverSeq: 1,
  ...overrides,
});

type PushHandler = (mutations: Mutation[]) => MutationResult[] | Promise<MutationResult[]>;
type PullHandler = (query: PullQuery) => PullResponse | Promise<PullResponse>;

/** A scripted server: every call is recorded, and each endpoint answers with the given function. */
export class FakeApi implements SyncApi {
  readonly pushes: Mutation[][] = [];
  readonly pulls: PullQuery[] = [];

  constructor(
    public onPush: PushHandler = (mutations) =>
      mutations.map((m, i) => ({
        mutationId: m.mutationId,
        status: 'applied' as const,
        version: i + 1,
      })),
    public onPull: PullHandler = () => emptyPull(),
  ) {}

  async push(mutations: Mutation[]) {
    this.pushes.push(mutations);
    return this.onPush(mutations);
  }

  async pull(query: PullQuery) {
    this.pulls.push(query);
    return this.onPull(query);
  }
}

export const httpError = (status: number) => new ApiError(status, null, `HTTP ${status}`);
