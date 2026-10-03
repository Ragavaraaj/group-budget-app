import {
  addDays,
  nextOccurrence,
  RECURRING_MAX_BACKFILL_DAYS,
  type RecurringData,
  type RecurringRow,
  toIndiaDate,
} from '@budget/shared';
import type { RecurringServer, Schedule } from './types';

/**
 * Where a rule stands after an edit, worked out here because it is the server's to decide:
 * the day the next expense is due, and the last one made. A paused rule has no next date. A
 * rule that was paused and is switched on again starts from today rather than catching up on
 * what it missed, and no rule goes back further than `RECURRING_MAX_BACKFILL_DAYS`.
 *
 * A rule keeps its creator, who is the person the generated expenses are made on behalf of, until
 * that person has left the group. Then the rule would wait for ever, so whoever edits it next
 * takes it over (`creatorHasLeft`).
 */
export function recurringServerFields(
  data: RecurringData,
  existing: RecurringRow | undefined,
  userId: string,
  now: number,
  creatorHasLeft = false,
): RecurringServer {
  const resumed = existing !== undefined && !existing.active && data.active;
  const schedule = scheduleOf(data, existing?.lastGeneratedOn ?? null, now, resumed);
  const tookOver = existing !== undefined && creatorHasLeft;
  return {
    createdBy: existing && !creatorHasLeft ? existing.createdBy : userId,
    ...schedule,
    resumed,
    tookOver,
  };
}

/**
 * A rule's schedule after it is deleted (nothing is ever due while it is, so the job's index
 * doesn't carry it) or restored. An Undo soon after the delete (the same day in India) loses
 * nothing: the rule carries on from the last date it made, as if it had not been deleted. A rule
 * that was gone longer starts again from today, the same as a resumed one, so it never revives
 * dates from while it was deleted. Either way it goes back no further than the backfill floor.
 */
export function recurringTombstoneSchedule(
  rule: RecurringRow,
  deleting: boolean,
  now: number,
): Schedule {
  if (deleting) return { lastGeneratedOn: rule.lastGeneratedOn, nextDueOn: null };
  const undo =
    rule.deletedAt !== null && toIndiaDate(new Date(rule.deletedAt)) === toIndiaDate(new Date(now));
  return scheduleOf(rule, rule.lastGeneratedOn, now, !undo);
}

function scheduleOf(
  data: RecurringData | RecurringRow,
  lastGeneratedOn: string | null,
  now: number,
  restart: boolean,
): Schedule {
  const today = toIndiaDate(new Date(now));
  let last = lastGeneratedOn;
  if (restart) {
    const yesterday = addDays(today, -1);
    if (last === null || last < yesterday) last = yesterday;
  }
  const floor = addDays(today, -RECURRING_MAX_BACKFILL_DAYS - 1);
  const after = last !== null && last > floor ? last : floor;
  return { lastGeneratedOn: last, nextDueOn: data.active ? nextOccurrence(data, after) : null };
}
