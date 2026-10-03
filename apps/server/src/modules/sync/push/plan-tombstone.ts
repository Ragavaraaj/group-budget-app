import type { RecurringRow } from '@budget/shared';
import { applied, type PlanContext, reject } from './context';
import { recurringTombstoneSchedule } from './recurring';
import { type Known, key, type Tombstone } from './types';

/** A delete or a restore. Asking for the state a row is already in is a harmless no-op. */
export function planTombstone(
  context: PlanContext,
  m: Tombstone,
  existing: Known | undefined,
): void {
  const { plan, known, room, userId, now } = context;
  if (!existing) {
    reject(plan, m, 'not_found');
    return;
  }
  const deleting = m.op === 'delete';
  if ((existing.deletedAt !== null) === deleting) {
    plan.noops.push(m); // already in the requested state
    applied(plan, m, existing.version, false);
    return;
  }
  // Restoring puts a row back among the group's budgets and rules, so it counts against the
  // cap; deleting one gives its place back, for what comes later in this same push.
  if (deleting) room.release(m.entity, m.groupId);
  else if (!room.take(m.entity, m.groupId)) {
    reject(plan, m, 'limit_reached');
    return;
  }

  const version = existing.version + 1;
  const deletedAt = deleting ? now : null;
  const schedule =
    m.entity === 'recurring'
      ? recurringTombstoneSchedule(existing.snapshot as RecurringRow, deleting, now)
      : undefined;
  const after = {
    ...(existing.snapshot as object),
    version,
    updatedAt: now,
    updatedBy: userId,
    deletedAt,
    ...schedule,
  };
  plan.writes.push({
    kind: m.op,
    mutation: m,
    before: existing.snapshot,
    after,
    ...(schedule ? { schedule } : {}),
  });
  known.set(key(m.entity, m.id), { groupId: m.groupId, version, deletedAt, snapshot: after });
  applied(plan, m, version, false);
}
