import type { RecurringRow } from '@budget/shared';
import { applied, type PlanContext, reject } from './context';
import { recurringServerFields } from './recurring';
import { referencesAreValid } from './references';
import { type Known, key, type Upsert } from './types';

/**
 * Expenses and payments keep the person who first saved them. An edit by someone else changes
 * `updatedBy` only, so the audit trail must not name the editor as the creator either.
 */
function creatorOf(m: Upsert, existing: Known | undefined, userId: string) {
  if (m.entity !== 'expense' && m.entity !== 'settlement') return {};
  const before = existing?.snapshot as { createdBy?: string } | undefined;
  return { createdBy: before?.createdBy ?? userId };
}

/** A create or an edit: last writer wins, but never over a tombstone. */
export function planUpsert(context: PlanContext, m: Upsert, existing: Known | undefined): void {
  const { plan, members, known, room, userId, now } = context;
  const groupId = m.data.groupId;
  // A delete wins over a concurrent edit; undoing it is an explicit `restore`.
  if (existing?.deletedAt != null) {
    reject(plan, m, 'deleted');
    return;
  }
  if (!referencesAreValid(m, groupId, members, known)) {
    reject(plan, m, 'invalid_reference');
    return;
  }
  if (existing === undefined && !room.take(m.entity, groupId)) {
    reject(plan, m, 'limit_reached');
    return;
  }

  const version = (existing?.version ?? 0) + 1;
  const conflict =
    existing !== undefined && m.baseVersion !== null && m.baseVersion < existing.version;
  const rule = existing?.snapshot as RecurringRow | undefined;
  const creatorLeft = rule !== undefined && !members.active.get(groupId)?.has(rule.createdBy);
  const server =
    m.entity === 'recurring'
      ? recurringServerFields(m.data, rule, userId, now, creatorLeft)
      : undefined;
  const after = {
    ...m.data,
    version,
    updatedAt: now,
    updatedBy: userId,
    deletedAt: null,
    ...creatorOf(m, existing, userId),
    ...(server
      ? {
          createdBy: server.createdBy,
          lastGeneratedOn: server.lastGeneratedOn,
          nextDueOn: server.nextDueOn,
        }
      : {}),
  };
  plan.writes.push({
    kind: 'upsert',
    mutation: m,
    version,
    before: existing?.snapshot ?? null,
    after,
    ...(server ? { server } : {}),
  });
  known.set(key(m.entity, m.data.id), { groupId, version, deletedAt: null, snapshot: after });
  applied(plan, m, version, conflict);
}
