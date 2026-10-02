import {
  addDays,
  nextOccurrence,
  occurrencesAfter,
  RECURRING_MAX_BACKFILL_DAYS,
  RECURRING_MAX_PER_RUN,
  recurringExpenseId,
  toIndiaDate,
} from '@budget/shared';
import { and, asc, eq, isNull, lte, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { memberships, recurringRules } from '../../db/schema';

export interface GenerateResult {
  /** Occurrences turned into expenses in this run. */
  generated: number;
  /** Rules this run moved on, including any that was only moved past a date already made. */
  rules: number;
  /** The groups that got new expenses, so their members' apps can be told. */
  groupIds: string[];
}

/**
 * Nobody in the template (payers or split) has left the group. The expense would put a debt on
 * someone who can no longer see the group, so a rule that names them waits until a member edits
 * it. In SQL, so such a rule never takes one of the run's few places from a rule that can run.
 */
const everyoneStillIn = sql`NOT EXISTS (
  SELECT 1 FROM ${memberships} AS gone
  WHERE gone.group_id = ${recurringRules.groupId}
    AND gone.removed_at IS NOT NULL
    AND (
      EXISTS (SELECT 1 FROM json_each(${recurringRules.payers}) AS p
              WHERE json_extract(p.value, '$.userId') = gone.user_id)
      OR EXISTS (SELECT 1 FROM json_each(${recurringRules.shares}) AS s
                 WHERE json_extract(s.value, '$.userId') = gone.user_id)
    )
)`;

/**
 * When someone the rule involves (its creator, a payer or a person in the split) last came back
 * to the group, if that was after the rule was last edited. A rule is only ever saved while all of
 * them are in, so a later `joined_at` means they left and returned (reinstated, or rejoined through
 * a link) in the meantime. The rule waited while they were away, and picks up from the day they
 * returned: it must not make up, in their name, the weeks they weren't in the group.
 */
const returnedSinceEdit = sql<number | null>`(
  SELECT MAX(back.joined_at) FROM ${memberships} AS back
  WHERE back.group_id = ${recurringRules.groupId}
    AND back.joined_at > ${recurringRules.updatedAt}
    AND (
      back.user_id = ${recurringRules.createdBy}
      OR EXISTS (SELECT 1 FROM json_each(${recurringRules.payers}) AS p
                 WHERE json_extract(p.value, '$.userId') = back.user_id)
      OR EXISTS (SELECT 1 FROM json_each(${recurringRules.shares}) AS s
                 WHERE json_extract(s.value, '$.userId') = back.user_id)
    )
)`;

/** The rule is still the one this run read: not edited, not deleted, not moved on by another run. */
const STILL_DUE = `id = ? AND version = ? AND next_due_on = ? AND deleted_at IS NULL AND active = 1`;

/** The next change number for the i-th (1-based) of `count` rows written by one batch. */
const seqSql = (count: number, index: number) =>
  `(SELECT value FROM sync_counter WHERE id = 1) - ${count - index}`;

/**
 * The scheduled job: turns recurring rules that have come due into ordinary expenses, which then
 * reach every device through the normal pull.
 *
 * It works in small, atomic runs because a Worker invocation on the free plan may make only 50
 * D1 queries: one read finds the due rules, then ONE batch writes at most `limit` occurrences
 * (each is an expense and an audit row), plus one update per rule. A bigger backlog simply takes
 * more runs; the job is scheduled hourly.
 *
 * Two runs, or a run and a person editing the rule, can overlap, and the batch is built so that
 * the overlap changes nothing twice. The expense id is derived from the rule and the date, and
 * every statement for a rule is conditional on the rule still being as this run read it (same
 * version, same next date, not deleted): the first writer moves the rule on, so the other writes
 * no expense, no audit row, and reports nothing. A rule edited in the meantime is simply picked
 * up again, with its new content, by the next run. Dates at or before the last one made are never
 * made again, even if an edit that was planned before a run and committed after it put the next
 * date back.
 *
 * Rules whose creator has left the group, or that name someone who has, wait: nobody is
 * answerable for the expense. Any remaining member can delete the rule, or take it over by
 * editing it (see `recurringServerFields`).
 */
export async function generateDueExpenses(
  db: Db,
  now: number,
  limit: number = RECURRING_MAX_PER_RUN,
): Promise<GenerateResult> {
  const today = toIndiaDate(new Date(now));

  const due = await db
    .select({ rule: recurringRules, returnedAt: returnedSinceEdit })
    .from(recurringRules)
    .innerJoin(
      memberships,
      and(
        eq(memberships.groupId, recurringRules.groupId),
        eq(memberships.userId, recurringRules.createdBy),
        isNull(memberships.removedAt),
      ),
    )
    .where(
      and(
        isNull(recurringRules.deletedAt),
        eq(recurringRules.active, true),
        lte(recurringRules.nextDueOn, today),
        everyoneStillIn,
      ),
    )
    .orderBy(asc(recurringRules.nextDueOn))
    .limit(limit);

  // Work out what each rule makes in this run, oldest first, without going over the limit.
  const plans: {
    rule: (typeof due)[number]['rule'];
    /** Empty for a rule that only needs moving past a date it has already made. */
    dates: string[];
    next: string | null;
  }[] = [];
  let room = limit;
  // No run goes back further than an edit could (`scheduleOf` in the sync push).
  const floor = addDays(today, -RECURRING_MAX_BACKFILL_DAYS - 1);
  for (const { rule, returnedAt } of due) {
    if (room <= 0 || rule.nextDueOn === null) break;
    // Not before the day before the next date, the last date made, the floor, or the day before
    // someone came back (the day they came back is made).
    const after = [
      addDays(rule.nextDueOn, -1),
      rule.lastGeneratedOn,
      floor,
      returnedAt === null ? null : addDays(toIndiaDate(new Date(returnedAt)), -1),
    ].reduce<string>((latest, date) => (date !== null && date > latest ? date : latest), '');
    const dates = occurrencesAfter(rule, after, today, room);
    const next = nextOccurrence(rule, dates.at(-1) ?? after);
    if (dates.length === 0 && next === rule.nextDueOn) continue;
    room -= dates.length;
    plans.push({ rule, dates, next });
  }
  if (plans.length === 0) return { generated: 0, rules: 0, groupIds: [] };

  // Raw statements: they are `INSERT ... SELECT ... WHERE` (and `changes()`), which Drizzle's
  // query builders can't express. The expense is copied from the rule row itself, so what is
  // written is exactly the version the guard checked.
  const d1 = db.$client;
  const occurrences = plans.reduce((sum, plan) => sum + plan.dates.length, 0);
  // Every row written takes a change number: each expense, and each rule that made some.
  const total = occurrences + plans.filter((plan) => plan.dates.length > 0).length;
  const statements: D1PreparedStatement[] = [];
  if (total > 0) {
    statements.push(
      d1.prepare('UPDATE sync_counter SET value = value + ? WHERE id = 1').bind(total),
    );
  }
  const updateAt: number[] = [];
  let index = 0;

  for (const { rule, dates, next } of plans) {
    const guard = [rule.id, rule.version, rule.nextDueOn] as const;
    for (const date of dates) {
      const id = await recurringExpenseId(rule.id, date);
      statements.push(
        d1
          .prepare(
            `INSERT INTO expenses (id, group_id, occurred_on, amount_minor, category_id, note,
               split_type, payers, shares, created_by, version, updated_at, updated_by,
               deleted_at, server_seq)
             SELECT ?, group_id, ?, amount_minor, category_id, note, split_type, payers, shares,
               created_by, 1, ?, created_by, NULL, ${seqSql(total, ++index)}
             FROM recurring_rules WHERE ${STILL_DUE}
             ON CONFLICT DO NOTHING`,
          )
          .bind(id, date, now, ...guard),
        // Only when the expense was really written (`changes()`): a rerun or an expense that
        // was made before and since deleted adds nothing to the log.
        d1
          .prepare(
            `INSERT INTO audit_log (mutation_id, user_id, group_id, entity, entity_id, before, after, at)
             SELECT ?, created_by, group_id, 'expense', ?, NULL,
               json_object('id', ?, 'groupId', group_id, 'occurredOn', ?, 'amountMinor', amount_minor,
                 'categoryId', category_id, 'note', note, 'splitType', split_type,
                 'payers', json(payers), 'shares', json(shares), 'createdBy', created_by,
                 'version', 1, 'updatedAt', ?, 'updatedBy', created_by, 'deletedAt', NULL),
               ?
             FROM recurring_rules WHERE id = ? AND changes() > 0`,
          )
          .bind(`recurring:${rule.id}:${date}`, id, id, date, now, now, rule.id),
      );
    }

    // The version is left alone: a person editing the rule at the same moment isn't in conflict
    // with the job. When it made expenses the change number moves too, so devices pick up the
    // new "last made" date; a rule that is only being moved past today needn't bother them.
    updateAt.push(statements.length);
    statements.push(
      d1
        .prepare(
          `UPDATE recurring_rules
           SET last_generated_on = ?, next_due_on = ?${
             dates.length > 0 ? `, server_seq = ${seqSql(total, ++index)}` : ''
           }
           WHERE ${STILL_DUE}`,
        )
        .bind(dates.at(-1) ?? rule.lastGeneratedOn, next, ...guard),
    );
  }

  const results = await d1.batch(statements);

  // A rule counts only if its own update took effect: that is the one that says this run, and
  // not another, moved it on. Only rules that made expenses tell their group.
  const moved = plans.filter((_, i) => (results[updateAt[i] as number]?.meta.changes ?? 0) > 0);
  const made = moved.filter((plan) => plan.dates.length > 0);
  return {
    generated: made.reduce((sum, plan) => sum + plan.dates.length, 0),
    rules: moved.length,
    groupIds: [...new Set(made.map((plan) => plan.rule.groupId))],
  };
}
