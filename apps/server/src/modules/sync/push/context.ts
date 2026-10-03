import type { Mutation, MutationResult, RejectReason } from '@budget/shared';
import type { Loaded } from './load';
import type { Room } from './room';
import type { Plan } from './types';

/** What planning one mutation can see and change. */
export interface PlanContext extends Loaded {
  userId: string;
  now: number;
  room: Room;
  plan: Plan;
}

const result = (plan: Plan, entry: MutationResult): void => {
  plan.results.push(entry);
};

export const reject = (plan: Plan, m: Mutation, reason: RejectReason): void =>
  result(plan, { mutationId: m.mutationId, status: 'rejected', reason });

export const applied = (plan: Plan, m: Mutation, version: number, conflict: boolean): void =>
  result(plan, {
    mutationId: m.mutationId,
    status: 'applied',
    version,
    ...(conflict ? { conflict: true } : {}),
  });
