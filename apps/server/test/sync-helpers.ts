import {
  type CategoryRow,
  type EntityName,
  type MeResponse,
  type Mutation,
  type PullResponse,
  type PushResponse,
  uuidv7,
} from '@budget/shared';
import { Client } from './helpers';

export interface Person {
  client: Client;
  id: string;
  email: string;
  name: string;
  personalGroupId: string;
}

export async function signedIn(email: string, name?: string): Promise<Person> {
  const client = new Client();
  const { user } = await client.signInAsDev(email, name);
  const me = (await (await client.get('/api/me')).json()) as MeResponse;
  return {
    client,
    id: user.id,
    email,
    name: user.displayName,
    personalGroupId: me.personalGroupId,
  };
}

const base = () => ({ mutationId: uuidv7(), createdAt: Date.now() });

export function expenseData(
  groupId: string,
  payerId: string,
  overrides: Partial<{
    id: string;
    amountMinor: number;
    categoryId: string | null;
    note: string;
    occurredOn: string;
    payers: { userId: string; amountMinor: number }[];
    shares: { userId: string; amountMinor: number }[];
    splitType: 'equal' | 'exact' | 'percent' | 'shares';
  }> = {},
) {
  const amountMinor = overrides.amountMinor ?? 10_000;
  return {
    id: uuidv7(),
    groupId,
    occurredOn: '2026-10-02',
    amountMinor,
    categoryId: null,
    note: 'lunch',
    splitType: 'equal' as const,
    payers: [{ userId: payerId, amountMinor }],
    shares: [{ userId: payerId, amountMinor }],
    ...overrides,
  };
}

export const upsert = (
  entity: EntityName,
  data: { id: string; groupId: string } & Record<string, unknown>,
  baseVersion: number | null = null,
): Mutation => ({ ...base(), baseVersion, op: 'upsert', entity, data }) as unknown as Mutation;

export const tombstone = (
  op: 'delete' | 'restore',
  entity: EntityName,
  id: string,
  groupId: string,
  baseVersion: number | null = null,
): Mutation => ({ ...base(), baseVersion, op, entity, id, groupId });

export async function push(person: Person, mutations: Mutation[]) {
  const response = await person.client.post('/api/sync/push', { mutations });
  if (response.status !== 200) {
    throw new Error(`push failed: ${response.status} ${await response.text()}`);
  }
  return ((await response.json()) as PushResponse).results;
}

export async function pull(
  person: Person,
  query: { since?: number; limit?: number; groupId?: string } = {},
) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined) params.set(k, String(v));
  const response = await person.client.get(`/api/sync/pull?${params}`);
  return { status: response.status, body: (await response.json()) as PullResponse };
}

/** Follows `hasMore` to the end and returns everything, like a device catching up. */
export async function pullAll(person: Person, since = 0, limit = 100, groupId?: string) {
  const merged: PullResponse = {
    cursor: since,
    hasMore: false,
    groups: [],
    members: [],
    categories: [],
    expenses: [],
    settlements: [],
    budgets: [],
    recurring: [],
  };
  let pages = 0;
  for (;;) {
    const { status, body } = await pull(person, { since: merged.cursor, limit, groupId });
    if (status !== 200) throw new Error(`pull failed: ${status}`);
    pages++;
    merged.groups.push(...body.groups);
    merged.members.push(...body.members);
    merged.categories.push(...body.categories);
    merged.expenses.push(...body.expenses);
    merged.settlements.push(...body.settlements);
    merged.budgets.push(...body.budgets);
    merged.recurring.push(...body.recurring);
    merged.cursor = body.cursor;
    if (!body.hasMore) break;
    if (pages > 500) throw new Error('pull did not terminate');
  }
  return { ...merged, pages };
}

export async function categoriesOf(person: Person, groupId: string): Promise<CategoryRow[]> {
  const { categories } = await pullAll(person);
  return categories.filter((c) => c.groupId === groupId);
}

export async function makeInvite(owner: Person, groupId: string) {
  const response = await owner.client.post(`/api/groups/${groupId}/invites`);
  return (await response.json()) as { token: string; expiresAt: number; maxUses: number };
}

export async function createSharedGroup(owner: Person, name = 'Goa trip') {
  const response = await owner.client.post('/api/groups', { name });
  return ((await response.json()) as { groupId: string }).groupId;
}

export async function join(person: Person, token: string) {
  return person.client.post('/api/invites/accept', { token });
}
