import type { Mutation } from '@budget/shared';
import type { Db } from '../../../db/client';
import { type PlanContext, reject } from './context';
import { loadForPush } from './load';
import { planTombstone } from './plan-tombstone';
import { planUpsert } from './plan-upsert';
import { roomLeft } from './room';
import { entityIdOf, groupIdOf, key, type Plan, unique } from './types';

/** Decides, mutation by mutation, what the push writes and what it refuses. Nothing is written. */
export async function planMutations(
  db: Db,
  userId: string,
  todo: Mutation[],
  now: number,
): Promise<Plan> {
  const loaded = await loadForPush(db, userId, todo);
  // Groups can only hold so many budgets and rules. Counted only when something new is being
  // created, and per group, so the common push (expenses) pays nothing for it.
  const room = await roomLeft(db, todo, loaded.known);
  const plan: Plan = { results: [], writes: [], noops: [], recipients: [] };
  const context: PlanContext = { ...loaded, userId, now, room, plan };

  for (const m of todo) {
    const groupId = groupIdOf(m);
    if (!loaded.activeMember.has(groupId)) {
      reject(plan, m, 'not_a_member');
      continue;
    }
    const existing = loaded.known.get(key(m.entity, entityIdOf(m)));
    if (existing && existing.groupId !== groupId) reject(plan, m, 'group_mismatch');
    else if (m.op === 'upsert') planUpsert(context, m, existing);
    else planTombstone(context, m, existing);
  }

  const written = new Set(plan.writes.map((write) => groupIdOf(write.mutation)));
  plan.recipients = unique(
    loaded.memberRows
      .filter((row) => row.removedAt === null && written.has(row.groupId))
      .map((row) => row.userId),
  );
  return plan;
}
