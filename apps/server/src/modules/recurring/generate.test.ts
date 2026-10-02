import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { addDays, RECURRING_MAX_PER_RUN, toIndiaDate, uuidv7 } from '@budget/shared';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, resetDb } from '../../../test/helpers';
import {
  categoriesOf,
  createSharedGroup,
  expenseData,
  join,
  makeInvite,
  type Person,
  pullAll,
  push,
  signedIn,
  tombstone,
  upsert,
} from '../../../test/sync-helpers';
import { createDb } from '../../db/client';
import { auditLog, expenses, recurringRules } from '../../db/schema';
import worker from '../../index';
import { generateDueExpenses } from './generate';

let alice: Person;
let groupId: string;

beforeEach(async () => {
  await resetDb();
  alice = await signedIn('alice@example.com', 'Alice');
  groupId = alice.personalGroupId;
});

const today = () => toIndiaDate(new Date());
const NOW = () => Date.now();

function ruleData(
  group: string,
  payerId: string,
  overrides: Record<string, unknown> = {},
): { id: string; groupId: string } & Record<string, unknown> {
  const { occurredOn: _day, ...expense } = expenseData(group, payerId, {
    note: 'Rent',
    amountMinor: 8_000_00,
  });
  return {
    ...expense,
    frequency: 'monthly',
    startOn: today(),
    endOn: null,
    active: true,
    ...overrides,
  };
}

const allExpenses = () => db.select().from(expenses);
const ruleRow = async (id: string) =>
  (await db.select().from(recurringRules).where(eq(recurringRules.id, id)))[0];

describe('generating recurring expenses', () => {
  it('turns a rule that is due today into an expense and moves the rule on', async () => {
    const rule = ruleData(groupId, alice.id, { frequency: 'monthly', startOn: today() });
    await push(alice, [upsert('recurring', rule)]);

    const result = await generateDueExpenses(db, NOW());
    expect(result).toEqual({ generated: 1, rules: 1 });

    const [expense] = await allExpenses();
    expect(expense).toMatchObject({
      groupId,
      occurredOn: today(),
      amountMinor: 8_000_00,
      note: 'Rent',
      splitType: 'equal',
      createdBy: alice.id,
      updatedBy: alice.id,
      version: 1,
      deletedAt: null,
    });
    const after = await ruleRow(rule.id);
    expect(after?.lastGeneratedOn).toBe(today());
    expect(after?.nextDueOn).not.toBe(today());
    expect(after?.version).toBe(1); // the job does not count as an edit
  });

  it('puts the new expense and the moved rule in front of the devices, through the pull', async () => {
    const rule = ruleData(groupId, alice.id);
    await push(alice, [upsert('recurring', rule)]);
    const before = await pullAll(alice);

    await generateDueExpenses(db, NOW());
    const pulled = await pullAll(alice, before.cursor);
    expect(pulled.expenses).toHaveLength(1);
    expect(pulled.expenses[0]?.serverSeq).toBeGreaterThan(before.cursor);
    expect(pulled.recurring[0]).toMatchObject({ id: rule.id, lastGeneratedOn: today() });
  });

  it('does nothing when nothing is due, and nothing the second time', async () => {
    const future = ruleData(groupId, alice.id, { startOn: addDays(today(), 5) });
    await push(alice, [upsert('recurring', future)]);
    expect(await generateDueExpenses(db, NOW())).toEqual({ generated: 0, rules: 0 });

    const rule = ruleData(groupId, alice.id);
    await push(alice, [upsert('recurring', rule)]);
    await generateDueExpenses(db, NOW());
    expect(await generateDueExpenses(db, NOW())).toEqual({ generated: 0, rules: 0 });
    expect(await allExpenses()).toHaveLength(1);
  });

  it('writes the same expense, not a second one, if two runs race for the same occurrence', async () => {
    const rule = ruleData(groupId, alice.id);
    await push(alice, [upsert('recurring', rule)]);
    const results = await Promise.all([
      generateDueExpenses(db, NOW()),
      generateDueExpenses(db, NOW()),
    ]);
    expect(results.length).toBe(2);
    expect(await allExpenses()).toHaveLength(1);
  });

  it('catches up on what was missed, oldest first, and keeps each date', async () => {
    const rule = ruleData(groupId, alice.id, {
      frequency: 'weekly',
      startOn: addDays(today(), -21),
    });
    await push(alice, [upsert('recurring', rule)]);

    const result = await generateDueExpenses(db, NOW());
    expect(result.generated).toBe(4);
    const dates = (await allExpenses()).map((e) => e.occurredOn).sort();
    expect(dates).toEqual([-21, -14, -7, 0].map((d) => addDays(today(), d)));
  });

  it('never makes more than the limit in a run, and the next run carries on', async () => {
    const rule = ruleData(groupId, alice.id, {
      frequency: 'weekly',
      startOn: addDays(today(), -7 * 12),
    });
    await push(alice, [upsert('recurring', rule)]);

    const first = await generateDueExpenses(db, NOW(), 5);
    expect(first.generated).toBe(5);
    const second = await generateDueExpenses(db, NOW(), 5);
    expect(second.generated).toBe(5);
    const third = await generateDueExpenses(db, NOW(), 5);
    expect(third.generated).toBe(3); // 13 occurrences in all: 12 weeks back … today
    expect(await generateDueExpenses(db, NOW(), 5)).toEqual({ generated: 0, rules: 0 });

    const dates = (await allExpenses()).map((e) => e.occurredOn);
    expect(new Set(dates).size).toBe(13);
  });

  it('leaves paused, deleted and ended rules alone', async () => {
    const paused = ruleData(groupId, alice.id, { active: false });
    const deleted = ruleData(groupId, alice.id);
    const ended = ruleData(groupId, alice.id, {
      startOn: addDays(today(), -60),
      endOn: addDays(today(), -50),
    });
    await push(alice, [
      upsert('recurring', paused),
      upsert('recurring', deleted),
      upsert('recurring', ended),
    ]);
    await push(alice, [tombstone('delete', 'recurring', deleted.id, groupId, 1)]);

    // Only the one occurrence inside the ended rule's life is made, and then it has no next date.
    expect(await generateDueExpenses(db, NOW())).toEqual({ generated: 1, rules: 1 });
    expect((await ruleRow(ended.id))?.nextDueOn).toBeNull();
    expect(await generateDueExpenses(db, NOW())).toEqual({ generated: 0, rules: 0 });
  });

  it('waits when the person who made the rule has left the group', async () => {
    const bob = await signedIn('bob@example.com', 'Bob');
    const shared = await createSharedGroup(alice);
    await join(bob, (await makeInvite(alice, shared)).token);
    const rule = ruleData(shared, bob.id, { shares: [{ userId: bob.id, amountMinor: 8_000_00 }] });
    await push(bob, [upsert('recurring', rule)]);
    await bob.client.request(`/api/groups/${shared}/members/${bob.id}`, { method: 'DELETE' });

    expect(await generateDueExpenses(db, NOW())).toEqual({ generated: 0, rules: 0 });
    expect(await allExpenses()).toHaveLength(0);
  });

  it('keeps the category, the payers and the exact shares of the template', async () => {
    const bob = await signedIn('bob@example.com', 'Bob');
    const shared = await createSharedGroup(alice);
    await join(bob, (await makeInvite(alice, shared)).token);
    const categoryId = (await categoriesOf(alice, shared))[0]?.id ?? null;
    const rule = ruleData(shared, alice.id, {
      categoryId,
      amountMinor: 10_001,
      splitType: 'exact',
      payers: [{ userId: alice.id, amountMinor: 10_001 }],
      shares: [
        { userId: alice.id, amountMinor: 6_001 },
        { userId: bob.id, amountMinor: 4_000 },
      ],
    });
    await push(alice, [upsert('recurring', rule)]);
    await generateDueExpenses(db, NOW());

    const [expense] = await allExpenses();
    expect(expense).toMatchObject({
      categoryId,
      amountMinor: 10_001,
      splitType: 'exact',
      payers: [{ userId: alice.id, amountMinor: 10_001 }],
      shares: [
        { userId: alice.id, amountMinor: 6_001 },
        { userId: bob.id, amountMinor: 4_000 },
      ],
    });
    // Bob sees it through his own pull.
    expect((await pullAll(bob)).expenses.some((e) => e.id === expense?.id)).toBe(true);
  });

  it('records each generated expense in the audit log', async () => {
    await push(alice, [upsert('recurring', ruleData(groupId, alice.id))]);
    await generateDueExpenses(db, NOW());
    const entries = (await db.select().from(auditLog)).filter((a) =>
      a.mutationId.startsWith('recurring:'),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ entity: 'expense', userId: alice.id, groupId });
  });
});

describe('what a run costs', () => {
  /** Counts the statements and rows a run sends to D1 (the free plan allows 50 per invocation). */
  function counting() {
    let statements = 0;
    let rowsRead = 0;
    const d1 = new Proxy(env.DB, {
      get(target, prop, receiver) {
        if (prop === 'prepare') {
          return (query: string) => {
            statements += 1;
            return target.prepare(query);
          };
        }
        if (prop === 'batch') {
          return async (batch: D1PreparedStatement[]) => {
            const results = await target.batch(batch);
            for (const r of results) rowsRead += r.meta.rows_read ?? 0;
            return results;
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    return { db: createDb(d1 as D1Database), statements: () => statements, rows: () => rowsRead };
  }

  it('stays inside 50 queries even when the run does as much as it is allowed to', async () => {
    // Ten rules, all due, one occurrence each: the most statements a run can produce.
    await push(
      alice,
      Array.from({ length: RECURRING_MAX_PER_RUN }, () =>
        upsert('recurring', ruleData(groupId, alice.id, { note: `Rule ${uuidv7().slice(-4)}` })),
      ),
    );
    const counted = counting();
    const result = await generateDueExpenses(counted.db, NOW());
    expect(result).toEqual({ generated: RECURRING_MAX_PER_RUN, rules: RECURRING_MAX_PER_RUN });
    expect(counted.statements()).toBeLessThanOrEqual(40);
  });

  it('reads next to nothing when many rules exist but none is due', async () => {
    const group = groupId;
    for (let i = 0; i < 5; i++) {
      await push(
        alice,
        Array.from({ length: 10 }, () =>
          upsert('recurring', ruleData(group, alice.id, { startOn: addDays(today(), 30) })),
        ),
      );
    }
    const counted = counting();
    await generateDueExpenses(counted.db, NOW());
    // (The one read goes through the plain driver, not `batch`, so it is the index that matters:
    // a missing index would turn this into a scan of every rule, which the next test would show.)
    expect(counted.statements()).toBeLessThanOrEqual(2);
  });
});

describe('the Worker entry', () => {
  it('runs the job from the scheduled event', async () => {
    await push(alice, [upsert('recurring', ruleData(groupId, alice.id))]);
    const ctx = createExecutionContext();
    await worker.scheduled?.(
      createScheduledController({ scheduledTime: Date.now(), cron: '0 * * * *' }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(await allExpenses()).toHaveLength(1);
  });
});
