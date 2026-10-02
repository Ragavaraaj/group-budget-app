import {
  type Mutation,
  type MutationResult,
  type PullResponse,
  pullResponseSchema,
  pushResponseSchema,
} from '@budget/shared';
import { apiGet, apiSend } from '@/lib/api';

export interface PullQuery {
  since: number;
  limit?: number;
  /** Fetch one group's full history (used after joining a group). */
  groupId?: string;
}

/** What the sync engine needs from the server. Tests substitute their own. */
export interface SyncApi {
  push(mutations: Mutation[]): Promise<MutationResult[]>;
  pull(query: PullQuery): Promise<PullResponse>;
}

export const httpSyncApi: SyncApi = {
  async push(mutations) {
    const body = await apiSend('POST', '/api/sync/push', { mutations }, pushResponseSchema);
    return body.results;
  },
  pull({ since, limit, groupId }) {
    const params = new URLSearchParams({ since: String(since) });
    if (limit !== undefined) params.set('limit', String(limit));
    if (groupId !== undefined) params.set('groupId', groupId);
    return apiGet(`/api/sync/pull?${params}`, pullResponseSchema);
  },
};
