import {
  addDays,
  nextOccurrence,
  occurrencesAfter,
  RECURRING_MAX_PER_RUN,
  recurringExpenseId,
  toIndiaDate,
} from '@budget/shared';
import { and, asc, eq, isNull, lte } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { reserveSeq, runBatch, seqFor } from '../../db/batch';
import type { Db } from '../../db/client';
import { auditLog, expenses, memberships, recurringRules } from '../../db/schema';

type Statement = BatchItem<'sqlite'>;

export interface GenerateResult {
  /** Occurrences turned into expenses in this run. */
  generated: number;
  /** Rules that moved on. */
  rules: number;
  /** The groups that got new expenses, so their members' apps can be told. */
  groupIds: string[];
}

/**
 * The scheduled job: turns recurring rules that have come due into ordinary expenses, which then
 * reach every device through the normal pull.
 *
 * It works in small, atomic runs because a Worker invocation on the free plan may make only 50
 * D1 queries: one read finds the due rules, then ONE batch writes at most `limit` occurrences
 * (each is an expense and an audit row), plus one update per rule. A bigger backlog simply takes
 * more runs; the job is scheduled hourly.
 *
 * Running twice for the same occurrence is harmless: the expense id is derived from the rule and
 * the date, so the second insert changes nothing, and each rule's update only applies if the rule
 * is still at the date this run read.
 *
 * Rules whose creator has left the group wait: nobody is answerable for the expense, and any
 * remaining member can delete or take over the rule by editing it.
 */
export async function generateDueExpenses(
  db: Db,
  now: number,
  limit: number = RECURRING_MAX_PER_RUN,
): Promise<GenerateResult> {
  const today = toIndiaDate(new Date(now));

  const due = await db
    .select({ rule: recurringRules })
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
      ),
    )
    .orderBy(asc(recurringRules.nextDueOn))
    .limit(limit);

  // Work out what each rule makes in this run, oldest first, without going over the limit.
  const plans: {
    rule: (typeof due)[number]['rule'];
    dates: string[];
    next: string | null;
  }[] = [];
  let room = limit;
  for (const { rule } of due) {
    if (room <= 0 || rule.nextDueOn === null) break;
    const dates = occurrencesAfter(rule, addDays(rule.nextDueOn, -1), today, room);
    if (dates.length === 0) continue;
    room -= dates.length;
    plans.push({ rule, dates, next: nextOccurrence(rule, dates.at(-1) ?? null) });
  }

  const occurrences = plans.reduce((sum, plan) => sum + plan.dates.length, 0);
  if (occurrences === 0) return { generated: 0, rules: 0, groupIds: [] };

  // Every row written takes a change number: each expense, and each rule that moved on.
  const total = occurrences + plans.length;
  const statements: Statement[] = [reserveSeq(db, total)];
  let index = 0;

  for (const { rule, dates } of plans) {
    for (const date of dates) {
      const id = await recurringExpenseId(rule.id, date);
      const row = {
        id,
        groupId: rule.groupId,
        occurredOn: date,
        amountMinor: rule.amountMinor,
        categoryId: rule.categoryId,
        note: rule.note,
        splitType: rule.splitType,
        payers: rule.payers,
        shares: rule.shares,
        createdBy: rule.createdBy,
        version: 1,
        updatedAt: now,
        updatedBy: rule.createdBy,
        deletedAt: null,
      };
      statements.push(
        db
          .insert(expenses)
          .values({ ...row, serverSeq: seqFor(total, ++index) })
          .onConflictDoNothing(),
        db.insert(auditLog).values({
          mutationId: `recurring:${rule.id}:${date}`,
          userId: rule.createdBy,
          groupId: rule.groupId,
          entity: 'expense',
          entityId: id,
          before: null,
          after: row,
          at: now,
        }),
      );
    }
  }

  for (const { rule, dates, next } of plans) {
    // The version is left alone: a person editing the rule at the same moment isn't in conflict
    // with the job. Only the change number moves, so devices pick the new dates up.
    statements.push(
      db
        .update(recurringRules)
        .set({ lastGeneratedOn: dates.at(-1), nextDueOn: next, serverSeq: seqFor(total, ++index) })
        .where(
          and(
            eq(recurringRules.id, rule.id),
            rule.nextDueOn === null
              ? isNull(recurringRules.nextDueOn)
              : eq(recurringRules.nextDueOn, rule.nextDueOn),
          ),
        ),
    );
  }

  await runBatch(db, statements);
  return {
    generated: occurrences,
    rules: plans.length,
    groupIds: [...new Set(plans.map((plan) => plan.rule.groupId))],
  };
}
